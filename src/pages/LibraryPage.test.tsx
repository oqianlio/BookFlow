import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LibraryPage from "./LibraryPage";
import * as api from "../services/api";
import { fetchToc } from "../services/sourceToc";
import { downloadBook } from "../services/chapterCache";

vi.mock("../services/sourceToc", () => ({ fetchToc: vi.fn(), clearTocCache: vi.fn() }));
vi.mock("../services/chapterCache", () => ({ downloadBook: vi.fn().mockResolvedValue({ done: 2, total: 2, failed: 0 }) }));

const books = [
  { id: 1, title: "三体", format: "epub", path: "b1.epub", cover_path: null, added_at: 1, last_opened_at: null },
  { id: 2, title: "算法导论", format: "pdf", path: "b2.pdf", cover_path: null, added_at: 2, last_opened_at: null },
];

const shelfSource = {
  id: 9, source_id: 3, source_name: "示例", book_url: "https://ex.com/b/1.html",
  title: "球状闪电", author: "刘慈欣", cover_url: null, added_at: 3, last_opened_at: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([]);
  vi.spyOn(api, "getProgress").mockResolvedValue(null);
  vi.spyOn(api, "getBookSourceProgress").mockResolvedValue(null);
  vi.spyOn(api, "listShelfGroups").mockResolvedValue([]);
  vi.spyOn(api, "listBookLists").mockResolvedValue([]);
  vi.spyOn(api, "removeShelfItems").mockResolvedValue([]);
  vi.mocked(fetchToc).mockResolvedValue({
    info: { title: "", author: "", intro: "", coverUrl: "" },
    toc: [],
  });
});

describe("LibraryPage", () => {
  it("renders book cards and empty state", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("算法导论")).toBeInTheDocument();
  });

  it("shows read progress in both modes", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "getProgress").mockImplementation(async (id: number) => (id === 1 ? ["3", 0.42] : null));
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 网格模式：卡片底部显示百分比
    expect(await screen.findByText("42%")).toBeInTheDocument();
    // 列表模式：副行同样显示百分比
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(screen.getAllByText("42%").length).toBeGreaterThanOrEqual(1);
  });

  it("shows relative last-opened time in list mode", async () => {
    const opened = [{ ...books[0], last_opened_at: Math.floor(Date.now() / 1000) - 2 * 86400 }];
    vi.spyOn(api, "listBooks").mockResolvedValue(opened);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 网格无时间信息；切到列表显示
    expect(screen.queryByText("2 天前")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(await screen.findByText("2 天前")).toBeInTheDocument();
  });

  it("calls importFiles on import click", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    const spy = vi.spyOn(api, "importFiles").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("书架空空如也，点击导入书籍");
    await userEvent.click(screen.getByRole("button", { name: /导入书籍/ }));
    expect(spy).toHaveBeenCalled();
  });

  it("shows empty state when no books", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText(/书架空空如也/)).toBeInTheDocument();
  });

  it("toggles the search panel", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText(/书架空空如也/);
    await userEvent.click(screen.getByRole("button", { name: /全文搜索/ }));
    expect(screen.getByPlaceholderText("输入书名，搜索本地书和在线书源")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /全文搜索/ }));
    expect(screen.queryByPlaceholderText("输入书名，搜索本地书和在线书源")).not.toBeInTheDocument();
  });

  it("renders local and source books together", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByText("球状闪电")).toBeInTheDocument();
    // 网格模式：在线书无副行标签；列表模式才显示
    expect(document.querySelectorAll(".md3-card-grid .fmt").length).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(screen.queryByText("示例")).not.toBeInTheDocument();
  });

  it("opens a source book via onOpenSourceBook", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    const onOpenSourceBook = vi.fn();
    render(<LibraryPage onOpenBook={() => {}} onOpenSourceBook={onOpenSourceBook} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开 球状闪电" }));
    expect(onOpenSourceBook).toHaveBeenCalledWith(shelfSource);
  });

  it("removes a source book from the shelf after confirming", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    const spy = vi.spyOn(api, "removeShelfItems").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    // MD3: 点击更多操作按钮打开菜单 → 移除书架
    await userEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    await userEvent.click(screen.getByRole("button", { name: "移除书架" }));
    // 自定义确认框：确定后执行删除
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(spy).toHaveBeenCalledWith([{ item_kind: "source", item_id: 9 }]);
  });

  it("shows current and latest chapter for source books in list mode", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    vi.spyOn(api, "getBookSourceProgress").mockResolvedValue({
      source_id: 3, book_url: "https://ex.com/b/1.html", title: "球状闪电",
      chapter_index: 2, chapter_url: "u3", chapter_name: "第三章", percent: 0.42, updated_at: 0,
    });
    vi.mocked(fetchToc).mockResolvedValue({
      info: { title: "", author: "", intro: "", coverUrl: "" },
      toc: [{ name: "第一百章", url: "u100" }],
    });
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("球状闪电");
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    // MD3列表：显示进度在badge和书名下方
    expect(await screen.findByText("第三章")).toBeInTheDocument();
    expect(screen.getByText("第一百章")).toBeInTheDocument();
  });

  it("marks new chapters after toc refresh when count grows", async () => {
    const tocInfoSpy = vi.spyOn(api, "setShelfSourceTocInfo").mockResolvedValue(undefined);
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([{ ...shelfSource, total_chapters: 1 }]);
    vi.mocked(fetchToc).mockResolvedValue({
      info: { title: "", author: "", intro: "", coverUrl: "" },
      toc: [
        { name: "第一章", url: "https://ex.com/c/1" },
        { name: "第二章", url: "https://ex.com/c/2" },
      ],
    });
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("球状闪电");
    await userEvent.click(screen.getByRole("button", { name: "更新目录" }));
    await waitFor(() => expect(tocInfoSpy).toHaveBeenCalledWith(9, 2, true, undefined, undefined));
  });

  it("shows the new-chapter dot for source books with updates", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([{ ...shelfSource, has_update: true }]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("球状闪电");
    expect(document.querySelector(".md3-dot-new")).toBeInTheDocument();
  });

  it("filters shelf books by title keyword", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    await userEvent.click(screen.getByRole("button", { name: "过滤书架" }));
    const input = screen.getByPlaceholderText(/按书名 \/ 作者 \/ 来源过滤/);
    await userEvent.type(input, "三体");
    // 只剩匹配的书
    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.queryByText("算法导论")).not.toBeInTheDocument();
    // 过滤行显示计数
    expect(await screen.findByText("1 本")).toBeInTheDocument();
  });

  it("shows book intro line for source books in list mode", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([
      { ...shelfSource, intro: "这是一个关于三体文明的故事" },
    ]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("球状闪电");
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(await screen.findByText(/关于三体文明的故事/)).toBeInTheDocument();
  });

  it("switches between grid and list layouts and persists the choice", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 默认网格 → 切到列表
    expect(document.querySelector(".book-grid")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    expect(document.querySelector(".book-list")).not.toBeNull();
    expect(document.querySelectorAll(".md3-card-list").length).toBe(2);
    expect(localStorage.getItem("library.layout")).toBe("list");
  });

  it("sorts by title and persists the choice", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([
      { ...books[1], last_opened_at: Math.floor(Date.now() / 1000) },
      books[0],
    ]);
    render(<LibraryPage onOpenBook={() => {}} />);
    // 默认按阅读时间降序：最近打开的算法导论在前
    await screen.findByText("算法导论");
    const grid = document.querySelector(".book-grid")!;
    expect(grid.children[0]).toHaveAttribute("aria-label", "打开 算法导论");
    // 打开排序菜单 → 按书名降序（拼音：算 suan > 三 san，降序算法导论在前）
    await userEvent.click(screen.getByRole("button", { name: "排序" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^书名/ }));
    expect(grid.children[0]).toHaveAttribute("aria-label", "打开 算法导论");
    expect(JSON.parse(localStorage.getItem("library.sort")!)).toEqual({ mode: 2, desc: true });
    // 切换为升序：三体在前
    await userEvent.click(screen.getByRole("button", { name: "排序" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^降序/ }));
    expect(grid.children[0]).toHaveAttribute("aria-label", "打开 三体");
  });

  it("shows group collage cards when enabled and filters on click", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "listShelfGroups").mockResolvedValue([{ id: 1, name: "科幻", member_count: 1, created_at: 1 }]);
    vi.spyOn(api, "listShelfGroupMembers").mockResolvedValue([{ item_kind: "local", item_id: 1 }]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 开启拼贴
    await userEvent.click(screen.getByRole("button", { name: "排序" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /分组显示为卡片/ }));
    expect(localStorage.getItem("library.groupCollage")).toBe("1");
    // 拼贴卡出现（组内 1 本 → 3 个空位补齐）
    const collage = await screen.findByRole("button", { name: "打开分组 科幻" });
    expect(collage).toBeInTheDocument();
    expect(collage.querySelectorAll(".gc-img, .gc-ph").length).toBe(4);
    expect(collage.textContent).toContain("1 本");
    // 点击拼贴卡 → 过滤到该分组
    await userEvent.click(collage);
    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.queryByText("算法导论")).not.toBeInTheDocument();
  });

  it("passes book kind tags through toc refresh and shows them in list mode", async () => {
    const tocInfoSpy = vi.spyOn(api, "setShelfSourceTocInfo").mockResolvedValue(undefined);
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([
      { ...shelfSource, kind: "科幻,末日" },
    ]);
    vi.mocked(fetchToc).mockResolvedValue({
      info: { title: "", author: "", intro: "", coverUrl: "", kind: "科幻,末日" },
      toc: [],
    });
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("球状闪电");
    // 更新目录时 kind 透传到后端（total_chapters 未记录 → null 保留原值）
    await userEvent.click(screen.getByRole("button", { name: "更新目录" }));
    await waitFor(() => expect(tocInfoSpy).toHaveBeenCalledWith(9, 0, false, "科幻,末日", undefined));
    await userEvent.click(screen.getByRole("button", { name: "切换为列表" }));
    // 标签行显示分类
    expect(await screen.findByText("科幻")).toBeInTheDocument();
    expect(screen.getByText("末日")).toBeInTheDocument();
  });
});

describe("LibraryPage 分组/多选/书单", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([]);
    vi.spyOn(api, "getProgress").mockResolvedValue(null);
    vi.spyOn(api, "getBookSourceProgress").mockResolvedValue(null);
    vi.spyOn(api, "listShelfGroups").mockResolvedValue([]);
    vi.spyOn(api, "listBookLists").mockResolvedValue([]);
    vi.spyOn(api, "removeShelfItems").mockResolvedValue([]);
    vi.mocked(fetchToc).mockResolvedValue({
      info: { title: "", author: "", intro: "", coverUrl: "" },
      toc: [],
    });
  });

  it("shows group chips and filters by group", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "listShelfGroups").mockResolvedValue([{ id: 1, name: "科幻", member_count: 1, created_at: 1 }]);
    vi.spyOn(api, "listShelfGroupMembers").mockResolvedValue([{ item_kind: "local", item_id: 1 }]);
    render(<LibraryPage onOpenBook={() => {}} />);
    expect(await screen.findByText("三体")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "科幻" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "科幻" }));
    // 只有三体（id 1 在组内）；算法导论被过滤
    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.queryByText("算法导论")).not.toBeInTheDocument();
    // 默认分组 = 不在任何组的书
    await userEvent.click(screen.getByRole("button", { name: "默认" }));
    expect(screen.queryByText("三体")).not.toBeInTheDocument();
    expect(screen.getByText("算法导论")).toBeInTheDocument();
  });

  it("creates a group via the manager dialog", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    const createSpy = vi.spyOn(api, "createShelfGroup").mockResolvedValue(5);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText(/书架空空如也/);
    await userEvent.click(screen.getByRole("button", { name: "管理分组" }));
    await userEvent.type(screen.getByPlaceholderText("新分组名称"), "修仙");
    await userEvent.click(screen.getByRole("button", { name: /新建/ }));
    expect(createSpy).toHaveBeenCalledWith("修仙");
  });

  it("batch selects books and moves them to a group", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    vi.spyOn(api, "listShelfGroups").mockResolvedValue([{ id: 2, name: "科幻", member_count: 0, created_at: 1 }]);
    vi.spyOn(api, "listShelfGroupMembers").mockResolvedValue([]);
    const addSpy = vi.spyOn(api, "addShelfGroupMembers").mockResolvedValue(undefined);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 进入多选：点「多选」按钮，然后点卡片切换勾选
    await userEvent.click(screen.getByRole("button", { name: "多选" }));
    await userEvent.click(screen.getByRole("button", { name: "选择 三体" }));
    await userEvent.click(screen.getByRole("button", { name: "选择 算法导论" }));
    expect(screen.getByText("2 本")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "移动到分组" }));
    // 弹窗中的分组行（名字 + 本数），避免与顶部分组 chip 同名冲突
    await userEvent.click(screen.getByRole("button", { name: "科幻0 本" }));
    expect(addSpy).toHaveBeenCalledWith(2, [
      { item_kind: "local", item_id: 1 },
      { item_kind: "local", item_id: 2 },
    ]);
  });

  it("creates a book list and shows it in the lists view", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    const createSpy = vi.spyOn(api, "createBookList").mockResolvedValue(7);
    const addSpy = vi.spyOn(api, "addBookListItem").mockResolvedValue(undefined);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    // 卡片菜单（第一张卡=三体）→ 加入书单 → 新建书单
    const menuBtns = await screen.findAllByRole("button", { name: "更多操作" });
    await userEvent.click(menuBtns[0]);
    await userEvent.click(await screen.findByRole("button", { name: "加入书单" }));
    await userEvent.click(screen.getByRole("button", { name: /新建书单/ }));
    await userEvent.type(screen.getByPlaceholderText("书单名称（必填）"), "年度必读");
    await userEvent.click(screen.getByRole("button", { name: "创建并加入" }));
    expect(createSpy).toHaveBeenCalledWith("年度必读", undefined);
    expect(addSpy).toHaveBeenCalledWith(7, "local", 1);
  });

  it("batch removes books after confirming", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue(books);
    const spy = vi.spyOn(api, "removeShelfItems").mockResolvedValue([]);
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("三体");
    await userEvent.click(screen.getByRole("button", { name: "多选" }));
    await userEvent.click(screen.getByRole("button", { name: "选择 三体" }));
    await userEvent.click(screen.getByRole("button", { name: "选择 算法导论" }));
    await userEvent.click(screen.getByRole("button", { name: "移除" }));
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(spy).toHaveBeenCalledWith([
      { item_kind: "local", item_id: 1 },
      { item_kind: "local", item_id: 2 },
    ]);
  });

  it("batch downloads selected source books after confirming", async () => {
    vi.spyOn(api, "listBooks").mockResolvedValue([]);
    vi.spyOn(api, "listShelfSourceBooks").mockResolvedValue([shelfSource]);
    vi.spyOn(api, "listBookSources").mockResolvedValue([
      { id: 3, name: "示例", url: "https://ex.com", enabled: true, last_used_at: null,
        json: JSON.stringify({ bookSourceName: "示例", bookSourceUrl: "https://ex.com" }) },
    ]);
    vi.mocked(fetchToc).mockResolvedValue({
      info: { title: "", author: "", intro: "", coverUrl: "" },
      toc: [
        { name: "第一章", url: "https://ex.com/c/1" },
        { name: "第二章", url: "https://ex.com/c/2" },
      ],
    });
    render(<LibraryPage onOpenBook={() => {}} />);
    await screen.findByText("球状闪电");
    await userEvent.click(screen.getByRole("button", { name: "多选" }));
    await userEvent.click(screen.getByRole("button", { name: "选择 球状闪电" }));
    await userEvent.click(screen.getByRole("button", { name: "下载离线" }));
    // 确认框显示在线书数量
    expect(screen.getByText(/下载选中的 1 本在线书/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(downloadBook).toHaveBeenCalledTimes(1));
    expect(downloadBook).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 3,
      bookUrl: "https://ex.com/b/1.html",
      toc: expect.arrayContaining([
        expect.objectContaining({ name: "第一章" }),
      ]),
    }));
  });
});
