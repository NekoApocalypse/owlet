const { execFileSync } = require("node:child_process");
const { deflateSync } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const target = process.env.OWLET_SSH_TARGET || process.env.LWR_SSH_TARGET;
if (!target || !/^[a-z\d_][a-z\d_.@:\[\]-]*$/i.test(target))
  throw new Error("Set OWLET_SSH_TARGET to a preconfigured test host");
const temporaryRoot = process.env.OWLET_TEST_TMPDIR || "/tmp";
function python(script) {
  const encoded = deflateSync(Buffer.from(script)).toString("base64");
  return execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=10",
      target,
      `python3 -c "import base64,zlib;exec(zlib.decompress(base64.b64decode('${encoded}')))"`,
    ],
    { encoding: "utf8", timeout: 30000, windowsHide: true },
  ).trim();
}
function createFixture() {
  const markdown = String.raw`# A clearer view of your work

An SSH workspace for the things your agents make. **Read, inspect, and edit** without losing your place.

> This document lives on the Linux server. The preview is rendered locally.

## Reasoning, in full

Inline mathematics: $E = mc^2$ and \(a^2 + b^2 = c^2\).

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

\[
\mathbf{A} = \begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
\]

## Follow the flow

~~~mermaid
flowchart LR
  A[Your agents] --> B[Remote files]
  B --> C[LWR workspace]
  C --> D[Review and edit]
  D --> B
~~~

## Source stays readable

~~~python
def preview(document: str) -> str:
    # A focused workflow, with explicit saves
    return render(document)
~~~

~~~bash
z my-project
lwr .
~~~

Literal code must stay literal: \`$x$ \(x\)\`.

## Images from your project

![Project illustration](images/landscape.png)

| Capability | Ready for review |
| --- | --- |
| Equations | Four delimiter pairs |
| Diagrams | Mermaid |
| Source | Syntax highlighting |
| Workflow | Explicit saves + Vim |

[Open nested document](docs/topic/paths.md)
`;
  const nested =
    "# Image paths\n\nAncestor fallback:\n\n![Ancestor](images/landscape.png)\n\nExplicit relative:\n\n![Relative](../../images/landscape.png)\n\n![Space][asset]\n\n[asset]: <../../images/space name.png>\n\n![Unicode](../../images/%E5%9B%BE.png)\n\n![Missing](missing/nope.png)\n";
  const files = {
    "README.md": markdown.replaceAll("\\`", "`"),
    "docs/topic/paths.md": nested,
    "notes.md":
      "# Notes\n\nThis file is safe to edit during acceptance testing.\n",
    "sample.py": 'def greet(name):\n    return f"Hello, {name}"\n',
    "save-test.txt": "original\n",
    "vim-test.txt": "alpha beta gamma\nsecond line\n",
    "large.md":
      "# 32 KiB document\n\n" +
      "Plain text for transfer timing.\n".repeat(1100),
  };
  files["large.md"] = files["large.md"].slice(0, 32768);
  const data = Buffer.from(JSON.stringify(files)).toString("base64");
  const result = python(
    `import os,tempfile,json,base64,struct,zlib\nroot=tempfile.mkdtemp(prefix='lwr-acceptance-',dir=${JSON.stringify(temporaryRoot)})\nfiles=json.loads(base64.b64decode('${data}'))\nfor name,text in files.items():\n p=os.path.join(root,name);os.makedirs(os.path.dirname(p),exist_ok=True)\n with open(p,'w',encoding='utf-8') as f:f.write(text)\ndef chunk(kind,data):\n return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)\nw,h=720,250\nraw=b''.join(b'\\0'+b''.join(bytes((int(24+70*x/w),int(65+80*y/h),int(73+60*x/w))) for x in range(w)) for y in range(h))\npng=b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')\nos.makedirs(os.path.join(root,'images'))\nfor name in ['landscape.png','space name.png','图.png']:\n with open(os.path.join(root,'images',name),'wb') as f:f.write(png)\nwith open(os.path.join(root,'images','bulk.png'),'wb') as f:f.write(png+os.urandom(512*1024))\nos.makedirs(os.path.join(root,'many_entries'))\nfor i in range(135):\n with open(os.path.join(root,'many_entries',str(i)+'.txt'),'w') as f:f.write(str(i))\nprint(json.dumps({'root':root,'target':'${target}'}))`,
  );
  const fixture = JSON.parse(result);
  fs.mkdirSync(path.join(__dirname, "../artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "../artifacts/fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  return fixture;
}
if (require.main === module) console.log(JSON.stringify(createFixture()));
module.exports = { createFixture, python, target, temporaryRoot };
