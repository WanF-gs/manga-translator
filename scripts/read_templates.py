import xml.etree.ElementTree as ET

templates = [
    ('1-软件调研报告', r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_unpack_1\word\document.xml'),
    ('2-软件需求规格说明书', r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_unpack_2\word\document.xml'),
    ('3-系统设计', r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_unpack_3\word\document.xml'),
    ('4-软件测试报告', r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_unpack_4\word\document.xml'),
    ('5-项目总结', r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_unpack_5\word\document.xml'),
    ('6-讨论记录', r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_unpack_6\word\document.xml'),
]

NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
output = []

for name, path in templates:
    output.append('=' * 60)
    output.append(f'=== {name} ===')
    output.append('=' * 60)
    tree = ET.parse(path)
    root = tree.getroot()
    texts = []
    for t in root.iter(f'{{{NS}}}t'):
        if t.text:
            texts.append(t.text)
    full_text = ''.join(texts)
    output.append(full_text[:8000])
    output.append('...' * 10)
    output.append('')

result = '\n'.join(output)
with open(r'c:\Users\WanFi\Desktop\大三实训\demo_04\temp_templates.txt', 'w', encoding='utf-8') as f:
    f.write(result)
print("Done! Written to temp_templates.txt")
