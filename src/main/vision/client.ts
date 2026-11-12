import { USER_TEXT, SYSTEM_PROMPT } from './prompt'

export interface VisionImage {
  /** 不含 data: 前缀的 base64 */
  base64: string
  mime: string
}

export interface VisionRequest {
  apiBaseUrl: string
  apiKey: string
  model: string
  /** 同一道题可以有多张图：题目一张、解答一张 */
  images: VisionImage[]
}

export interface VisionResponse {
  content: string
  finishReason: string
}

const TIMEOUT_MS = 60_000

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}${path}`
}

async function requestOnce(req: VisionRequest): Promise<VisionResponse> {
  const url = joinUrl(req.apiBaseUrl, '/chat/completions')
  const body = {
    model: req.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_TEXT },
          ...req.images.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${image.mime};base64,${image.base64}` }
          }))
        ]
      }
    ],
    response_format: { type: 'json_object' },
    // 一道题带完整解答过程时，思考 + 输出很容易超过 4k，给到 8k 避免 JSON 被截断
    max_tokens: 8000,
    temperature: 0.1
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('timeout') || message.includes('Timeout')) {
      throw new Error('识别超时（60 秒），请检查网络后重试')
    }
    throw new Error(`无法连接识别接口：${message}`)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const brief = detail.slice(0, 300)
    if (res.status === 401) throw new Error('API Key 无效或已过期，请在设置里重新填写')
    if (res.status === 402) throw new Error('账户余额不足')
    if (res.status === 413) throw new Error('图片过大，请重新截图')
    throw new Error(`识别接口返回 ${res.status}：${brief || res.statusText}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    error?: { message?: string }
  }

  if (json.error?.message) throw new Error(`识别接口报错：${json.error.message}`)

  const choice = json.choices?.[0]
  const content = choice?.message?.content ?? ''
  return { content, finishReason: choice?.finish_reason ?? 'stop' }
}

/**
 * JSON 模式下 API 会把无法解析的内容替换成空格，content 可能只有空白而
 * finish_reason 仍是 stop。必须判空并重试一次。
 */
export async function requestRecognition(req: VisionRequest): Promise<VisionResponse> {
  const first = await requestOnce(req)
  if (first.content.trim().length > 0) {
    // 输出被 max_tokens 截断时 JSON 不完整，直接告诉用户怎么处理
    if (first.finishReason === 'length') {
      throw new Error('识别内容过长被截断，请缩小截图范围，或分成题目、解答两次截')
    }
    return first
  }
  const second = await requestOnce(req)
  if (second.content.trim().length === 0) {
    throw new Error('模型返回为空（可能是图片里没有可识别的内容），请换个区域重新截图')
  }
  if (second.finishReason === 'length') {
    throw new Error('识别内容过长被截断，请缩小截图范围，或分成题目、解答两次截')
  }
  return second
}
