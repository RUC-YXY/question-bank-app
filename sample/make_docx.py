"""生成测试用 DOCX：含标题、段落、表格与文本公式，用于验证 docx-preview 渲染。"""

from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(11)

doc.add_heading("高一物理 · 牛顿运动定律 单元测试", level=1)

p = doc.add_paragraph()
p.add_run("班级：__________　姓名：__________　得分：__________")
p.alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.add_heading("一、选择题（每题 4 分）", level=2)

doc.add_paragraph(
    "1. 质量为 2 kg 的物体受到 6 N 的合外力作用，其加速度大小为（　　）"
)
doc.add_paragraph("A. 1 m/s²　　B. 2 m/s²　　C. 3 m/s²　　D. 6 m/s²")

doc.add_paragraph(
    "2. 关于惯性，下列说法正确的是（　　）"
)
doc.add_paragraph("A. 速度越大的物体惯性越大")
doc.add_paragraph("B. 质量越大的物体惯性越大")
doc.add_paragraph("C. 惯性是一种力")
doc.add_paragraph("D. 静止的物体没有惯性")

doc.add_heading("二、填空题（每题 5 分）", level=2)
doc.add_paragraph("3. 牛顿第二定律的表达式为 F = ma，其中 F 的单位是 ________。")
doc.add_paragraph("4. 物体在光滑水平面上以 3 m/s 匀速运动，2 s 内通过的路程为 ________ m。")

doc.add_heading("三、计算题", level=2)
doc.add_paragraph(
    "5. 一物体从静止开始做匀加速直线运动，加速度 a = 2 m/s²，求 5 s 末的速度和 5 s 内的位移。"
)

doc.add_heading("四、数据表", level=2)

table = doc.add_table(rows=4, cols=4)
table.style = "Table Grid"
headers = ["实验次数", "质量 m/kg", "合外力 F/N", "加速度 a/(m·s⁻²)"]
for i, text in enumerate(headers):
    table.cell(0, i).text = text
rows = [
    ["1", "1.0", "2.0", "2.0"],
    ["2", "2.0", "2.0", "1.0"],
    ["3", "2.0", "4.0", "2.0"],
]
for r, row in enumerate(rows, start=1):
    for c, text in enumerate(row):
        table.cell(r, c).text = text

doc.add_paragraph()
doc.add_paragraph("参考公式：v = v₀ + at，x = v₀t + ½at²，F = ma。")

for section in doc.sections:
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.2)

out = r"D:\错题本\app\sample\sample-physics.docx"
doc.save(out)
print("saved:", out)
