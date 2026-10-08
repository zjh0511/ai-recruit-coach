# 產生測試用的「虛構」招募制度文件（不是任何真實公司的制度）。
#   python tools/fixtures/make_fixtures.py
# 產生：收入制度（虛構）.docx、晉升考核辦法（虛構）.html（再用 Edge 印成 PDF，見 uitest／selftest 說明）
import zipfile, os, html
HERE = os.path.dirname(os.path.abspath(__file__))

INCOME = [
  '○○人壽 業務人員收入制度（虛構測試用，非真實公司制度）',
  '第一條 適用對象：本公司登錄之業務人員。',
  '第二條 首年度佣金：依商品別，首年度佣金率為保費之 15% 至 40%，以商品佣金表為準。',
  '第三條 續年度佣金：第二年起依商品別給付續年度佣金，佣金率為保費之 2% 至 5%。',
  '第四條 新人津貼：到職後前 12 個月，每月發給新人津貼 25,000 元，條件為當月 FYC（首年度佣金）達 20,000 元以上；未達者當月不發給。',
  '第五條 季獎金：每季 FYC 達 150,000 元以上者，加發當季 FYC 之 10% 為季獎金。',
  '第六條 自行負擔費用：業務人員之交通費、通訊費由個人自行負擔；資格測驗報名費由公司負擔。',
  '第七條 本制度未規定之收入項目（例如組織津貼）另依晉升考核辦法辦理。',
]
SYSTEM = [
  ('h1', '○○人壽 業務人員晉升暨考核辦法（虛構測試用，非真實公司制度）'),
  ('p', '一、職級：業務員、業務主任、業務襄理、區經理。'),
  ('p', '二、晉升業務主任：到職滿 6 個月，最近 6 個月累計 FYC 達 300,000 元，且直轄增員 2 人。'),
  ('p', '三、晉升業務襄理：擔任業務主任滿 12 個月，所屬組織最近 12 個月累計 FYC 達 1,200,000 元，且直轄業務員 4 人以上。'),
  ('p', '四、組織津貼：業務主任以上，按所屬組織當月 FYC 之 5% 發給組織津貼；區經理為 8%。'),
  ('p', '五、新人培訓：到職第 1 個月參加 30 天新人訓練，由輔導主管一對一陪同展業 3 個月。'),
  ('p', '六、考核：每季 FYC 未達 60,000 元者列入輔導；連續 2 季未達者，終止業務合約。'),
  ('p', '七、本辦法未規定事項（例如退休金）不在本辦法範圍。'),
]

def docx(path, paras):
    body = ''.join(f'<w:p><w:r><w:t xml:space="preserve">{html.escape(t)}</w:t></w:r></w:p>' for t in paras)
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f'<w:body>{body}</w:body></w:document>')
    ct = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels); z.writestr('word/document.xml', doc)

docx(os.path.join(HERE, '收入制度（虛構）.docx'), INCOME)
with open(os.path.join(HERE, '晉升考核辦法（虛構）.html'), 'w', encoding='utf-8') as f:
    f.write('<!doctype html><meta charset="utf-8"><style>body{font:16px "Microsoft JhengHei",sans-serif;margin:40px}h1{font-size:22px}</style>')
    for tag, t in SYSTEM: f.write(f'<{tag}>{html.escape(t)}</{tag}>')
print('ok')
