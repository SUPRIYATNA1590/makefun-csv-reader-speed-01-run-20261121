// Faster drop-in for csv-reader 1.0.0.
// Same answers as the reference on every input, including all broken-CSV
// cases: BOM, stray CR, unterminated quotes, quote junk, short/long rows.
// Speed comes from slice-based fields instead of per-character string
// concatenation: an unquoted field is scanned once and sliced out whole,
// a quoted field is scanned once and sliced in segments only when it
// contains a doubled quote or a CR. No per-character value building,
// no helper call per field on the common path.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  while (true) {
    // Skip lines with no characters: LF or CRLF only.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;
    const fields = [];
    let ended;
    let lastQuoted = false;

    while (true) {
      let value;
      // Field at end of text after a trailing comma: one empty field.
      if (pos >= n) {
        value = '';
        ended = 2;
        lastQuoted = false;
      } else if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        pos++;
        let segStart = pos;
        let prefix = '';
        let closed = false;
        while (pos < n) {
          const c = text.charCodeAt(pos);
          if (c === 34) {
            if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) {
              prefix += text.slice(segStart, pos) + '"';
              pos += 2;
              segStart = pos;
              continue;
            }
            prefix += text.slice(segStart, pos);
            pos++;
            closed = true;
            break;
          }
          if (c === 13) {
            prefix += text.slice(segStart, pos) + '\n';
            line++;
            pos += (pos + 1 < n && text.charCodeAt(pos + 1) === 10) ? 2 : 1;
            segStart = pos;
            continue;
          }
          if (c === 10) line++;
          pos++;
        }
        if (!closed) {
          // Unterminated: the quote is literal, re-read as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          // Unquoted scan with initial value '"'.
          let pfx = '"';
          let start = pos;
          let endPos = n;
          ended = 2;
          while (pos < n) {
            const c = text.charCodeAt(pos);
            if (c === 44) { endPos = pos; pos++; ended = 0; break; }
            if (c === 10) { endPos = pos; pos++; line++; ended = 1; break; }
            if (c === 13) {
              if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) { endPos = pos; pos += 2; line++; ended = 1; break; }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              pfx += text.slice(start, pos);
              pos++;
              start = pos;
              continue;
            }
            pos++;
          }
          value = pfx + text.slice(start, endPos);
        } else if (pos >= n) {
          value = prefix;
          ended = 2;
        } else {
          const c2 = text.charCodeAt(pos);
          if (c2 === 44) { pos++; value = prefix; ended = 0; }
          else if (c2 === 10) { pos++; line++; value = prefix; ended = 1; }
          else if (c2 === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; value = prefix; ended = 1; }
          else {
            // Junk after the closing quote, read as unquoted.
            let pfx = prefix;
            let start = pos;
            let endPos = n;
            ended = 2;
            while (pos < n) {
              const c = text.charCodeAt(pos);
              if (c === 44) { endPos = pos; pos++; ended = 0; break; }
              if (c === 10) { endPos = pos; pos++; line++; ended = 1; break; }
              if (c === 13) {
                if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) { endPos = pos; pos += 2; line++; ended = 1; break; }
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                pfx += text.slice(start, pos);
                pos++;
                start = pos;
                continue;
              }
              pos++;
            }
            value = pfx + text.slice(start, endPos);
            if (value.length > prefix.length) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        // Unquoted field: scan to the next delimiter, slice it whole.
        lastQuoted = false;
        let pfx = '';
        let start = pos;
        let endPos = n;
        ended = 2;
        while (pos < n) {
          const c = text.charCodeAt(pos);
          if (c === 44) { endPos = pos; pos++; ended = 0; break; }
          if (c === 10) { endPos = pos; pos++; line++; ended = 1; break; }
          if (c === 13) {
            if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) { endPos = pos; pos += 2; line++; ended = 1; break; }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pfx += text.slice(start, pos);
            pos++;
            start = pos;
            continue;
          }
          pos++;
        }
        value = pfx ? pfx + text.slice(start, endPos) : text.slice(start, endPos);
      }
      fields.push(value);
      if (ended !== 0) break;
    }

    // A line that held only stray CRs is no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
