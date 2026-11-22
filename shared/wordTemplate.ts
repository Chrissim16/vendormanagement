/**
 * Q-14: what the app recognised in an uploaded Word template, as the settings page shows
 * it to the admin. Shared by the server, which finds it, and the screen, which reports it.
 */

export const MARKS = ["title", "date", "version"] as const;
export type Mark = (typeof MARKS)[number];
export const markLabels: Record<Mark, string> = { title: "[Title]", date: "[Date]", version: "[Version]" };
/** What each mark becomes in a file. */
export const markMeaning: Record<Mark, string> = {
  title: "the RFP's title",
  date: "the day the file is made, for example 22 Nov 2026",
  version: 'the review version, for example "Version 2"',
};
export type Place = "cover page" | "header" | "footer";

export interface TemplateFound {
  format: "dotx" | "docx";
  /** The template has words or pictures of its own in its body: its cover page. */
  coverPage: boolean;
  marks: Record<Mark, Place[]>;
  header: boolean;
  footer: boolean;
  /** Pictures in the template, such as a logo. */
  pictures: number;
  font: string | null;
  /** The name of each style the RFP's text uses, as the template calls it, or null when it has none. */
  styles: { heading1: string | null; heading2: string | null; heading3: string | null; listBullet: string | null; listNumber: string | null; table: string | null };
}

export interface WordTemplateInfo {
  /** The template in force, or null when the app's plain layout is used. */
  current: { id: string; fileName: string; sizeBytes: number; uploadedAt: string; uploadedBy: string; found: TemplateFound } | null;
}
