export interface DiscoveredPage {
  url: string;
  type: "page" | "product" | "category" | "tag" | "other";
  sourceId?: string;
}

export interface NewpagesDiscovery {
  sourceUrl: string;
  sourceHost: string;
  sitemapUrls: string[];
  pages: DiscoveredPage[];
  cmsCapabilities: string[];
}

export interface RawPage {
  url: string;
  status: number;
  title: string;
  description: string;
  canonical?: string;
  html: string;
  text: string;
  links: string[];
  imageUrls: string[];
}

export interface CapturedApiCall {
  url: string;
  method: string;
  status: number;
  requestBody?: string | null;
  responseBody?: string;
}

export interface NewpagesExtraction {
  discovery: NewpagesDiscovery;
  pages: RawPage[];
  apiCalls: CapturedApiCall[];
  mediaUrls: string[];
  warnings: string[];
}
