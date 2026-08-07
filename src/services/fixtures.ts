export const SAMPLE_HTML = `<!doctype html><html><body>
<ul class="book-list">
  <li><a class="b-name" href="/book/1.html">三体</a><span class="b-author">刘慈欣</span><img class="b-cover" src="/cover/1.jpg"/></li>
  <li><a class="b-name" href="/book/2.html">活着</a><span class="b-author">余华</span><img class="b-cover" src="/cover/2.jpg"/></li>
</ul>
<div id="content"><p>第一章正文第一段。</p><p>第一章正文第二段。</p></div>
</body></html>`;

export const SAMPLE_SOURCE: any = {
  bookSourceUrl: "https://example.com",
  bookSourceName: "示例书源",
  searchUrl: "https://example.com/search?q={{key}}",
  ruleSearch: {
    bookList: "@css:ul.book-list>li",
    name: "a.b-name@text",
    author: "span.b-author@text",
    coverUrl: "img.b-cover@src",
    bookUrl: "a.b-name@href",
  },
  ruleContent: { content: "#content" },
};
