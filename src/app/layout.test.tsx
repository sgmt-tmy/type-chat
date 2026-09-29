import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserInPage = vi.fn();

vi.mock("../server/session", () => ({ getCurrentUserInPage: () => getCurrentUserInPage() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const { default: RootLayout } = await import("./layout");

beforeEach(() => {
  getCurrentUserInPage.mockResolvedValue(null);
});

async function renderLayout() {
  // html 要素は document 直下に描画できないため、文字列にしてから解析する
  const html = renderToStaticMarkup(
    await RootLayout({
      children: <p>本文</p>,
    }),
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { html, doc };
}

describe("RootLayout", () => {
  it("html 要素の lang が ja である", async () => {
    const { html } = await renderLayout();
    expect(html).toMatch(/^<html lang="ja"/);
  });

  it("共通ヘッダーのリンクがある", async () => {
    const { doc } = await renderLayout();
    const link = doc.querySelector("header a");
    expect(link?.textContent).toBe("type-chat");
    expect(link?.getAttribute("href")).toBe("/");
  });

  it("利用者がいなければ利用者名のボタンがない", async () => {
    const { doc } = await renderLayout();
    expect(doc.querySelector("header button")).toBeNull();
  });

  it("利用者がいれば共通ヘッダーに利用者名のボタンがある", async () => {
    getCurrentUserInPage.mockResolvedValue({ id: "x", name: "たろう" });
    const { doc } = await renderLayout();
    expect(doc.querySelector("header button")?.textContent).toBe("たろう");
  });

  it("children が main の中に描画され、main に共通レイアウトのクラスが付く", async () => {
    const { doc } = await renderLayout();
    const main = doc.querySelector("main");
    expect(main?.textContent).toBe("本文");
    for (const name of ["mx-auto", "max-w-2xl", "px-4"]) {
      expect(main?.classList.contains(name)).toBe(true);
    }
  });

  it("トーストの表示領域（Toaster）がある", async () => {
    const { doc } = await renderLayout();
    expect(doc.querySelector("section[aria-label^='Notifications']")).not.toBeNull();
  });
});
