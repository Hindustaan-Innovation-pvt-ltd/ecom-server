/**
 * Lightweight, robust, and zero-dependency YAML-to-JSON parser.
 * Handles indented properties, nested objects, list arrays, arrays of objects,
 * multiline block scalars (| and >), inline comments, and strictly parsed primitives.
 */

function stripComment(str: string): string {
  const trimmed = str.trim();
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed.charAt(i);
    if (char === '"' && (i === 0 || trimmed.charAt(i - 1) !== '\\')) {
      if (!inSingleQuotes) inDoubleQuotes = !inDoubleQuotes;
    } else if (char === "'" && (i === 0 || trimmed.charAt(i - 1) !== '\\')) {
      if (!inDoubleQuotes) inSingleQuotes = !inSingleQuotes;
    } else if (char === '#' && !inDoubleQuotes && !inSingleQuotes) {
      if (i === 0 || /\s/.test(trimmed.charAt(i - 1))) {
        return trimmed.slice(0, i).trim();
      }
    }
  }
  return trimmed;
}

function parseValue(valStr: string): any {
  const cleanStr = stripComment(valStr);

  if (cleanStr === "") {
    return null;
  }

  // Double quotes
  if (cleanStr.startsWith('"') && cleanStr.endsWith('"') && cleanStr.length >= 2) {
    const inner = cleanStr.slice(1, -1);
    return inner
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }

  // Single quotes
  if (cleanStr.startsWith("'") && cleanStr.endsWith("'") && cleanStr.length >= 2) {
    const inner = cleanStr.slice(1, -1);
    return inner.replace(/''/g, "'");
  }

  const lower = cleanStr.toLowerCase();

  // Boolean
  if (lower === "true" || lower === "yes" || lower === "on") {
    return true;
  }
  if (lower === "false" || lower === "no" || lower === "off") {
    return false;
  }

  // Null
  if (lower === "null" || cleanStr === "~" || lower === "undefined") {
    return null;
  }

  // Number: must start with digit or sign, and strictly match numeric regex to avoid casting leading zero strings like "0123"
  const isNumeric = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(cleanStr);
  if (isNumeric) {
    return Number(cleanStr);
  }

  // Default: string
  return cleanStr;
}

export function parseYAML(yamlStr: string): any {
  const lines = yamlStr.split(/\r?\n/);
  const result: any = {};
  const stack: { indent: number; obj: any }[] = [{ indent: -1, obj: result }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }

    const trimmed = line.trim();

    // Skip empty lines or full-line comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.search(/\S/);

    // 1. Handle list items (e.g. "- item" or "- key: value")
    if (trimmed.startsWith("- ")) {
      const listContent = trimmed.slice(2).trim();

      // Adjust stack to find the array parent
      while (stack.length > 1) {
        const top = stack[stack.length - 1];
        if (top && top.indent >= indent) {
          stack.pop();
        } else {
          break;
        }
      }

      const parentNode = stack[stack.length - 1];
      if (!parentNode || !Array.isArray(parentNode.obj)) {
        // Fallback: If parent is not an array, do not attempt to push
        continue;
      }

      const parentArray = parentNode.obj;

      // Check if the list content is a key-value pair (object item)
      let isKeyValue = false;
      let listKey = "";
      let listValStr = "";

      if (listContent !== "" && !((listContent.startsWith('"') && listContent.endsWith('"')) || (listContent.startsWith("'") && listContent.endsWith("'")))) {
        const colon = listContent.indexOf(":");
        if (colon !== -1) {
          isKeyValue = true;
          listKey = listContent.slice(0, colon).trim();
          listValStr = listContent.slice(colon + 1).trim();

          if (listKey.startsWith('"') && listKey.endsWith('"') && listKey.length >= 2) {
            listKey = listKey.slice(1, -1);
          } else if (listKey.startsWith("'") && listKey.endsWith("'") && listKey.length >= 2) {
            listKey = listKey.slice(1, -1);
          }
        }
      }

      if (isKeyValue) {
        const itemObj: any = {};
        parentArray.push(itemObj);

        // Check if value is a block scalar inside list item
        if (listValStr.startsWith("|") || listValStr.startsWith(">")) {
          const type = listValStr.charAt(0);
          const accumulatedLines: string[] = [];
          let blockIndent = -1;
          let j = i + 1;

          while (j < lines.length) {
            const nextLine = lines[j];
            if (nextLine === undefined) {
              j++;
              continue;
            }
            if (nextLine.trim() === "") {
              accumulatedLines.push("");
              j++;
              continue;
            }
            const nextIndent = nextLine.search(/\S/);
            if (blockIndent === -1) {
              blockIndent = nextIndent;
              if (blockIndent <= indent) {
                break;
              }
            }
            if (nextIndent < blockIndent) {
              break;
            }
            accumulatedLines.push(nextLine.slice(blockIndent));
            j++;
          }
          i = j - 1;

          let valStr = "";
          if (type === "|") {
            valStr = accumulatedLines.join("\n");
          } else {
            let folded = "";
            for (let k = 0; k < accumulatedLines.length; k++) {
              const l = accumulatedLines[k];
              if (l === undefined) {
                continue;
              }
              if (l === "") {
                folded += "\n";
              } else {
                if (folded !== "" && !folded.endsWith("\n") && !l.startsWith(" ")) {
                  folded += " ";
                }
                folded += l;
              }
            }
            valStr = folded;
          }
          itemObj[listKey] = valStr;
        } else {
          itemObj[listKey] = parseValue(listValStr);
        }

        // Push this item object onto stack with list's indent so sibling key-values attach to it
        stack.push({ indent, obj: itemObj });
      } else {
        // List item is a primitive, block scalar, or empty (nesting starts on next line)
        if (listContent.startsWith("|") || listContent.startsWith(">")) {
          const type = listContent.charAt(0);
          const accumulatedLines: string[] = [];
          let blockIndent = -1;
          let j = i + 1;

          while (j < lines.length) {
            const nextLine = lines[j];
            if (nextLine === undefined) {
              j++;
              continue;
            }
            if (nextLine.trim() === "") {
              accumulatedLines.push("");
              j++;
              continue;
            }
            const nextIndent = nextLine.search(/\S/);
            if (blockIndent === -1) {
              blockIndent = nextIndent;
              if (blockIndent <= indent) {
                break;
              }
            }
            if (nextIndent < blockIndent) {
              break;
            }
            accumulatedLines.push(nextLine.slice(blockIndent));
            j++;
          }
          i = j - 1;

          let valStr = "";
          if (type === "|") {
            valStr = accumulatedLines.join("\n");
          } else {
            let folded = "";
            for (let k = 0; k < accumulatedLines.length; k++) {
              const l = accumulatedLines[k];
              if (l === undefined) {
                continue;
              }
              if (l === "") {
                folded += "\n";
              } else {
                if (folded !== "" && !folded.endsWith("\n") && !l.startsWith(" ")) {
                  folded += " ";
                }
                folded += l;
              }
            }
            valStr = folded;
          }
          parentArray.push(valStr);
        } else if (listContent === "") {
          // Look ahead to check if a nested array or object begins on the next line
          let nextIndent = -1;
          let isNextList = false;
          let isNextKeyVal = false;

          for (let j = i + 1; j < lines.length; j++) {
            const nextL = lines[j];
            if (nextL === undefined) continue;
            if (nextL.trim() === "" || nextL.trim().startsWith("#")) continue;
            nextIndent = nextL.search(/\S/);
            if (nextIndent > indent) {
              const nextTrim = nextL.trim();
              if (nextTrim.startsWith("- ")) {
                isNextList = true;
              } else if (nextTrim.indexOf(":") !== -1) {
                isNextKeyVal = true;
              }
            }
            break;
          }

          if (isNextList) {
            const subArray: any[] = [];
            parentArray.push(subArray);
            stack.push({ indent, obj: subArray });
          } else if (isNextKeyVal) {
            const subObj: any = {};
            parentArray.push(subObj);
            stack.push({ indent, obj: subObj });
          } else {
            parentArray.push(null);
          }
        } else {
          parentArray.push(parseValue(listContent));
        }
      }
      continue;
    }

    // 2. Handle key-value pairs (e.g. "key: value")
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    let key = trimmed.slice(0, colonIdx).trim();
    let valStr = trimmed.slice(colonIdx + 1).trim();

    if (key.startsWith('"') && key.endsWith('"') && key.length >= 2) {
      key = key.slice(1, -1);
    } else if (key.startsWith("'") && key.endsWith("'") && key.length >= 2) {
      key = key.slice(1, -1);
    }

    // Adjust stack to find the parent container
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top && top.indent >= indent) {
        stack.pop();
      } else {
        break;
      }
    }

    const parentNode = stack[stack.length - 1];
    if (!parentNode) {
      continue;
    }

    const parentObj = parentNode.obj;

    if (valStr.startsWith("|") || valStr.startsWith(">")) {
      const type = valStr.charAt(0);
      const accumulatedLines: string[] = [];
      let blockIndent = -1;
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine === undefined) {
          j++;
          continue;
        }
        if (nextLine.trim() === "") {
          accumulatedLines.push("");
          j++;
          continue;
        }
        const nextIndent = nextLine.search(/\S/);
        if (blockIndent === -1) {
          blockIndent = nextIndent;
          if (blockIndent <= indent) {
            break;
          }
        }
        if (nextIndent < blockIndent) {
          break;
        }
        accumulatedLines.push(nextLine.slice(blockIndent));
        j++;
      }
      i = j - 1;

      let val = "";
      if (type === "|") {
        val = accumulatedLines.join("\n");
      } else {
        let folded = "";
        for (let k = 0; k < accumulatedLines.length; k++) {
          const l = accumulatedLines[k];
          if (l === undefined) {
            continue;
          }
          if (l === "") {
            folded += "\n";
          } else {
            if (folded !== "" && !folded.endsWith("\n") && !l.startsWith(" ")) {
              folded += " ";
            }
            folded += l;
          }
        }
        val = folded;
      }
      parentObj[key] = val;
    } else if (valStr === "") {
      // Look ahead to check if next line starts a list or object
      let isArray = false;
      let isObject = false;

      for (let j = i + 1; j < lines.length; j++) {
        const nextL = lines[j];
        if (nextL === undefined) continue;
        if (nextL.trim() === "" || nextL.trim().startsWith("#")) continue;
        const nextIndent = nextL.search(/\S/);
        if (nextIndent > indent) {
          const nextTrim = nextL.trim();
          if (nextTrim.startsWith("- ")) {
            isArray = true;
          } else if (nextTrim.indexOf(":") !== -1) {
            isObject = true;
          }
        }
        break;
      }

      const newContainer = isArray ? [] : {};
      parentObj[key] = newContainer;
      stack.push({ indent, obj: newContainer });
    } else {
      parentObj[key] = parseValue(valStr);
    }
  }

  return result;
}
