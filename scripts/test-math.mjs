/** 临时验证：LaTeX → KaTeX MathML → OMML 的链路是否通。 */
import katex from 'katex'
import { mml2omml } from 'mathml2omml'

const samples = [
  '\\dfrac{x-1}{x+2}\\ge 0',
  'x\\in(-\\infty,-2)\\cup[1,+\\infty)',
  '\\sqrt[3]{x}+a_n^2',
  '\\begin{cases}-0.1x^2+20x-300,&0<x\\le 120\\\\-x-\\dfrac{25600}{x}+1050,&x>120\\end{cases}',
  '\\sum_{i=1}^{n} a_i = \\dfrac{n(a_1+a_n)}{2}'
]

for (const tex of samples) {
  const mathml = katex.renderToString(tex, {
    output: 'mathml',
    throwOnError: false,
    strict: 'ignore'
  })
  let omml = ''
  let error = ''
  try {
    omml = mml2omml(mathml)
  } catch (err) {
    error = err.message
  }
  console.log('---')
  console.log('TEX:', tex)
  console.log('MML:', mathml.slice(0, 160))
  console.log('OMML:', omml.slice(0, 220))
  if (error) console.log('ERROR:', error)
}
