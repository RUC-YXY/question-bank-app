interface ReadonlyInfoProps {
  /** 0–1 */
  confidence: number
  warnings: string[]
  rawModelOutput: string
}

export function ReadonlyInfo({ confidence, warnings, rawModelOutput }: ReadonlyInfoProps) {
  const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100)

  return (
    <div className="readonly-block">
      <div className="readonly-title">识别信息</div>

      <div>
        <div className="confidence-head">
          <span>置信度</span>
          <span>{percent}%</span>
        </div>
        <div className="confidence-track">
          <div
            className={`confidence-fill${percent < 60 ? ' low' : ''}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="warn-list">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}

      <details className="raw-details">
        <summary>原始模型输出</summary>
        <pre className="raw-output">{rawModelOutput || '（没有记录）'}</pre>
      </details>
    </div>
  )
}
