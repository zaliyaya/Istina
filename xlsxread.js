// Минимальный читатель .xlsx. Файл — это ZIP-архив с XML внутри, поэтому
// хватает разбора ZIP + двух XML. Внешние библиотеки не нужны: распаковку
// делает встроенный в браузер DecompressionStream.

// ---------- ZIP ----------

// ---------- распаковка (raw deflate) ----------
// Реализована вручную, чтобы чтение файлов не зависело от наличия
// DecompressionStream: в старых браузерах его нет, и загрузка молча ломалась.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83,
  99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5,
  5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13]
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

// Канонические коды Хаффмана: таблица «длина кода → первый код» + сортированные символы
function buildHuffman(lengths) {
  const maxBits = Math.max(...lengths)
  const blCount = new Array(maxBits + 1).fill(0)
  for (const l of lengths) if (l) blCount[l]++
  const nextCode = new Array(maxBits + 2).fill(0)
  let code = 0
  for (let bits = 1; bits <= maxBits; bits++) {
    code = (code + blCount[bits - 1]) << 1
    nextCode[bits] = code
  }
  const codes = new Map()
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]
    if (!len) continue
    codes.set(`${len}:${nextCode[len]++}`, i)
  }
  return { codes, maxBits }
}

function inflateRawSync(input) {
  let bitPos = 0
  const read = (n) => {
    let out = 0
    for (let i = 0; i < n; i++) {
      const byte = input[bitPos >> 3]
      if (byte === undefined) throw new Error('BAD_DEFLATE')
      out |= ((byte >> (bitPos & 7)) & 1) << i
      bitPos++
    }
    return out
  }
  const decode = (tree) => {
    let code = 0
    for (let len = 1; len <= tree.maxBits; len++) {
      code = (code << 1) | read(1)
      const sym = tree.codes.get(`${len}:${code}`)
      if (sym !== undefined) return sym
    }
    throw new Error('BAD_DEFLATE')
  }

  let out = new Uint8Array(Math.max(1024, input.length * 4))
  let pos = 0
  const push = (byte) => {
    if (pos >= out.length) {
      const bigger = new Uint8Array(out.length * 2)
      bigger.set(out)
      out = bigger
    }
    out[pos++] = byte
  }

  let fixedLit = null
  let fixedDist = null

  for (;;) {
    const final = read(1)
    const type = read(2)

    if (type === 0) {
      bitPos = (bitPos + 7) & ~7
      const start = bitPos >> 3
      const len = input[start] | (input[start + 1] << 8)
      bitPos = (start + 4) * 8
      for (let i = 0; i < len; i++) push(input[(bitPos >> 3) + i])
      bitPos += len * 8
    } else {
      let litTree
      let distTree
      if (type === 1) {
        if (!fixedLit) {
          const l = new Array(288)
          for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8
          fixedLit = buildHuffman(l)
          fixedDist = buildHuffman(new Array(30).fill(5))
        }
        litTree = fixedLit
        distTree = fixedDist
      } else if (type === 2) {
        const hlit = read(5) + 257
        const hdist = read(5) + 1
        const hclen = read(4) + 4
        const clen = new Array(19).fill(0)
        for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = read(3)
        const clTree = buildHuffman(clen)

        const lengths = []
        while (lengths.length < hlit + hdist) {
          const sym = decode(clTree)
          if (sym < 16) lengths.push(sym)
          else if (sym === 16) {
            const prev = lengths[lengths.length - 1]
            let repeat = 3 + read(2)
            while (repeat--) lengths.push(prev)
          } else if (sym === 17) {
            let repeat = 3 + read(3)
            while (repeat--) lengths.push(0)
          } else {
            let repeat = 11 + read(7)
            while (repeat--) lengths.push(0)
          }
        }
        litTree = buildHuffman(lengths.slice(0, hlit))
        distTree = buildHuffman(lengths.slice(hlit))
      } else {
        throw new Error('BAD_DEFLATE')
      }

      for (;;) {
        const sym = decode(litTree)
        if (sym === 256) break
        if (sym < 256) {
          push(sym)
        } else {
          const li = sym - 257
          const length = LEN_BASE[li] + read(LEN_EXTRA[li])
          const di = decode(distTree)
          const dist = DIST_BASE[di] + read(DIST_EXTRA[di])
          const from = pos - dist
          if (from < 0) throw new Error('BAD_DEFLATE')
          for (let i = 0; i < length; i++) push(out[from + i])
        }
      }
    }
    if (final) break
  }
  return out.subarray(0, pos)
}

function inflateRaw(bytes) {
  return inflateRawSync(bytes)
}

// Читаем central directory с конца файла — так надёжнее, чем идти по локальным
// заголовкам: у них размер может лежать в дескрипторе после данных.
function unzip(buffer) {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const len = bytes.length

  let eocd = -1
  for (let i = len - 22; i >= Math.max(0, len - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('NOT_ZIP')

  const count = view.getUint16(eocd + 10, true)
  let ptr = view.getUint32(eocd + 16, true)
  const files = {}

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break
    const method = view.getUint16(ptr + 10, true)
    const compSize = view.getUint32(ptr + 20, true)
    const nameLen = view.getUint16(ptr + 28, true)
    const extraLen = view.getUint16(ptr + 30, true)
    const commentLen = view.getUint16(ptr + 32, true)
    const localOff = view.getUint32(ptr + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))

    // размер локального заголовка переменный — читаем его поля
    const lnLen = view.getUint16(localOff + 26, true)
    const leLen = view.getUint16(localOff + 28, true)
    const dataOff = localOff + 30 + lnLen + leLen

    files[name] = { method, data: bytes.subarray(dataOff, dataOff + compSize) }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function readEntry(files, name) {
  const entry = files[name]
  if (!entry) return null
  const raw = entry.method === 0 ? entry.data : inflateRaw(entry.data)
  return new TextDecoder().decode(raw)
}

// ---------- XML ----------

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code] !== undefined ? ENTITIES[code] : m
  })
}

// Общие строки листа лежат отдельным словарём, ячейка ссылается на индекс
function parseSharedStrings(xml) {
  if (!xml) return []
  const out = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml))) {
    let text = ''
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let t
    while ((t = tRe.exec(m[1]))) text += decodeXml(t[1])
    out.push(text)
  }
  return out
}

function colToIndex(ref) {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i)
    if (code < 65 || code > 90) break
    n = n * 26 + (code - 64)
  }
  return n
}

// Excel хранит даты числом от 30.12.1899; на всякий случай учитываем
// историческую ошибку с 1900 годом
function excelDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000)
  return new Date(ms)
}

function parseSheet(xml, shared, dateStyles) {
  const rows = []
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(xml))) {
    const rIdx = /r="(\d+)"/.exec(rm[1])
    const rowNum = rIdx ? +rIdx[1] : rows.length + 1
    const cells = []
    // ([^>]*?) — нежадно: иначе шаблон съедает слеш у <c .../> и захватывает
    // содержимое следующей ячейки вплоть до её </c>
    const cellRe = /<c\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[1]
      const body = cm[2] || ''
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)
      const type = /t="([^"]+)"/.exec(attrs)
      const style = /s="(\d+)"/.exec(attrs)
      const col = ref ? colToIndex(ref[1]) : cells.length + 1

      let value = null
      const t = type ? type[1] : 'n'
      if (t === 'inlineStr') {
        let text = ''
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
        let tm
        while ((tm = tRe.exec(body))) text += decodeXml(tm[1])
        value = text
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body)
        if (vm) {
          const raw = decodeXml(vm[1])
          if (t === 's') value = shared[+raw] !== undefined ? shared[+raw] : ''
          else if (t === 'str' || t === 'e') value = raw
          else if (t === 'b') value = raw === '1'
          else {
            const num = Number(raw)
            value = Number.isFinite(num) ? num : raw
            if (style && dateStyles.has(+style[1]) && Number.isFinite(num) && num > 0) {
              value = excelDate(num)
            }
          }
        }
      }
      cells[col - 1] = value === undefined ? null : value
    }
    rows[rowNum - 1] = cells
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  return rows
}

// Какие стили означают дату — нужно, чтобы отличить дату от обычного числа
function parseDateStyles(stylesXml) {
  const set = new Set()
  if (!stylesXml) return set
  const custom = new Map()
  const fmtRe = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g
  let m
  while ((m = fmtRe.exec(stylesXml))) custom.set(+m[1], decodeXml(m[2]))

  const builtinDates = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57])
  const xfBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
  if (!xfBlock) return set
  const xfRe = /<xf\b([^>]*)\/?>/g
  let idx = 0
  let xm
  while ((xm = xfRe.exec(xfBlock[1]))) {
    const idAttr = /numFmtId="(\d+)"/.exec(xm[1])
    const id = idAttr ? +idAttr[1] : 0
    const code = custom.get(id)
    const isDate =
      builtinDates.has(id) || (code && /[dmyh]/i.test(code) && !/\[/.test(code.split(';')[0]))
    if (isDate) set.add(idx)
    idx++
  }
  return set
}

// ---------- публичный вход ----------

/**
 * Читает .xlsx и возвращает [{ name, rows }] — по одному объекту на лист.
 * rows — массив массивов значений (числа, строки, Date, null).
 */
function readXlsxSync(buffer) {
  const files = unzip(buffer)

  const workbook = readEntry(files, 'xl/workbook.xml')
  if (!workbook) throw new Error('NOT_XLSX')
  const rels = readEntry(files, 'xl/_rels/workbook.xml.rels')

  const relMap = {}
  if (rels) {
    const relRe = /<Relationship\b([^>]*)\/>/g
    let rm
    while ((rm = relRe.exec(rels))) {
      const id = /Id="([^"]+)"/.exec(rm[1])
      const target = /Target="([^"]+)"/.exec(rm[1])
      if (id && target) relMap[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\//, '')
    }
  }

  const shared = parseSharedStrings(readEntry(files, 'xl/sharedStrings.xml'))
  const dateStyles = parseDateStyles(readEntry(files, 'xl/styles.xml'))

  const sheets = []
  const sheetRe = /<sheet\b([^>]*)\/?>/g
  let sm
  let n = 0
  while ((sm = sheetRe.exec(workbook))) {
    n++
    const nameAttr = /name="([^"]*)"/.exec(sm[1])
    const ridAttr = /r:id="([^"]+)"/.exec(sm[1])
    const path = (ridAttr && relMap[ridAttr[1]]) || `worksheets/sheet${n}.xml`
    const xml = readEntry(files, 'xl/' + path)
    if (!xml) continue
    sheets.push({
      name: nameAttr ? decodeXml(nameAttr[1]) : 'Лист' + n,
      rows: parseSheet(xml, shared, dateStyles),
    })
  }
  if (!sheets.length) throw new Error('NO_SHEETS')
  return sheets
}


window.__readXlsxSync = readXlsxSync
