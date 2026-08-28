/**
 * 书源引擎模块
 * 统一导出所有功能
 */

// 规则解析 - 类型导出
export type {
  EngineResult,
  ParsedRule,
  BookSource,
  BookSourceRules,
  ExtractContext,
  BookInfo,
} from "./ruleParser";

// 规则解析 - 值导出
export {
  parseRule,
  cachedParseRule,
  resetRuleCache,
  splitReplaceSuffix,
  ABS_URL_RE,
  resolveUrl,
  isUrlField,
  splitAlternatives,
  parseHtml,
  emptyDoc,
  parseBookSourceJson,
  applyReplacements,
  applyRegexReplace,
} from "./ruleParser";

// 选择器
export {
  normalizeSelector,
  selectNodes,
  selectNodesSafe,
  queryIndexed,
  resolveTagIndex,
  nodeValue,
} from "./ruleSelector";

// 内容净化
export {
  purifyContent,
  isImageChapter,
  extractImageUrls,
} from "./contentPurifier";

// JSON Path
export { jsonGet } from "./jsonPath";

// 规则提取
export {
  hostOf,
  extractSingle,
  extractList,
  extractBookList,
  extractFromElement,
  extractFromJsObject,
  extractFromJsonObject,
} from "./ruleExtractor";

// JS 执行 - 类型导出
export type {
  JsContext,
  JsSource,
} from "./jsEvaluator";

// JS 执行 - 值导出
export {
  evalJs,
} from "./jsEvaluator";

// 搜索和探索 - 类型导出
export type {
  SearchResult,
} from "./searchEngine";

// 搜索和探索 - 值导出
export {
  parseSearchUrl,
  resolveSearchUrl,
  parseExploreUrl,
} from "./searchEngine";
