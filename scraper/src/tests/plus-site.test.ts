import { describe, it, expect, vi } from "vitest";
import PlusSite, { PLUS_OFFER_FILTER, plusApiVersion } from "../clients/plus/PlusSite";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// No real waiting between pages in tests.
vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
  fn();
  return 0 as any;
}) as any);

const ACTION =
  "screenservices/ECP_Composition_CW/ProductLists/PLP_Content/DataActionGetProductListAndCategoryInfo";
const SCRIPT = "/ECOP/scripts/ECP_Composition_CW.ProductLists.PLP_Content.mvc.js";
const script = (apiVersion: string) =>
  `return controller.callDataAction("DataActionGetProductListAndCategoryInfo", "${ACTION}", "${apiVersion}", function (b) {`;

const tile = (sku: string) => ({ PLP_Str: { SKU: sku, Name: `Product ${sku}` } });

/** A fake plus.nl: versions in the module info, pages of 2 products, an optional site release. */
function fakeSite(options: { releaseAfterPosts?: number } = {}) {
  let apiVersion = "api-1";
  let posts = 0;
  const http = {
    get: vi.fn(async (url: string) => {
      if (url === "/moduleservices/moduleversioninfo") return { data: { versionToken: "module-1" } };
      if (url.startsWith("/moduleservices/moduleinfo?")) {
        return { data: { manifest: { urlVersions: { "/scripts/Other.js": "?a", [SCRIPT]: "?v1" } } } };
      }
      if (url === `${SCRIPT}?v1`) return { data: script(apiVersion) };
      throw { response: { status: 404 } };
    }),
    post: vi.fn(async (url: string, body: any, config: any) => {
      expect(url).toBe(`/${ACTION}`);
      expect(config.headers["x-csrftoken"]).toBe("T6C+9iB49TLra4jEsMeSckDMNhQ=");
      posts++;
      if (options.releaseAfterPosts === posts) apiVersion = "api-2";
      if (body.versionInfo.apiVersion !== apiVersion) {
        return { data: { versionInfo: { hasModuleVersionChanged: false, hasApiVersionChanged: true }, data: {} } };
      }
      const page = body.screenData.variables.PageNumber;
      return {
        data: {
          data: {
            TotalPages: 2,
            TotalNumberItems: 4,
            ProductList: { List: [tile(`${page}a`), tile(`${page}b`), { PLP_Str: { SKU: "" } }] },
          },
        },
      };
    }),
  };
  return { http, site: new PlusSite(http as any) };
}

describe("PLUS site without a browser", () => {
  it("reads the api version from the product list script", () => {
    expect(plusApiVersion(script("cafT+CKg7ockKx+9Kx_BsQ"))).toBe("cafT+CKg7ockKx+9Kx_BsQ");
    expect(plusApiVersion("no action here")).toBeNull();
  });

  it("reads the versions and walks every page with the offers filter", async () => {
    const { http, site } = fakeSite();
    await site.open();
    const seen: string[] = [];
    const total = await site.forEachPage(PLUS_OFFER_FILTER, async (products) => {
      seen.push(...products.map((p) => p.SKU));
    });

    expect(total).toBe(4);
    expect(seen).toEqual(["1a", "1b", "2a", "2b"]);
    const body = http.post.mock.calls[0][1];
    expect(body.versionInfo).toEqual({ moduleVersion: "module-1", apiVersion: "api-1" });
    expect(body.viewName).toBe("MainFlow.ProductListPage");
    expect(body.screenData.variables).toMatchObject({ PageNumber: 1, CategorySlug: "", FilterQueryURL: PLUS_OFFER_FILTER });
  });

  it("reads the versions again when the site has a new release", async () => {
    const { site } = fakeSite({ releaseAfterPosts: 2 });
    await site.open();
    const first = await site.listPage(1);
    const second = await site.listPage(2);
    expect(first.products.map((p) => p.SKU)).toEqual(["1a", "1b"]);
    expect(second.products.map((p) => p.SKU)).toEqual(["2a", "2b"]);
  });

  it("says which step failed when plus.nl does not answer", async () => {
    const { http, site } = fakeSite();
    http.get.mockImplementation(async () => {
      throw { response: { status: 403 } };
    });
    await expect(site.open()).rejects.toThrow("PLUS module version: HTTP 403");
  });
});
