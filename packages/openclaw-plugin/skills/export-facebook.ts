/**
 * MirrorAI — export-facebook Skill.
 * Manual export guide for Facebook Messenger data.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── OpenClaw Export Skill Metadata ─────────────────────────────────────────
export const metadata = {
  id: "facebook",
  displayName: "Facebook Messenger",
  icon: "📘",
  status: "manual" as const,
  hasAutoExport: false,
  hasBotReply: false,
  manualExportGuide: [
    "1. Go to: facebook.com/dyi (Download Your Information)",
    "2. Select format: JSON",
    "3. Select: Messages only",
    "4. Click 'Request a download'",
    "5. Wait for email → download ZIP → extract",
  ],
  envKeys: ["FACEBOOK_EXPORT_PATH"],
};

/** Detect existing Facebook config */
export function detect(env: Record<string, string>, _home: string) {
  const exportPath = env.FACEBOOK_EXPORT_PATH || "";
  return {
    hasSession: false,
    hasExportData: false,
    exportMsgCount: 0,
    exportChats: 0,
    hasBotToken: false,
    botTokenMasked: "",
    hasExportPath: !!exportPath && existsSync(exportPath),
    exportPath,
    selfName: "",
  };
}

/** Interactive setup prompts */
export async function setup(inquirer: any, ctx: {
  env: Record<string, string>;
  envUpdates: Record<string, string>;
  detected: ReturnType<typeof detect>;
}) {
  const { detected, envUpdates } = ctx;

  const choices: Array<{ name: string; value: string }> = [];
  if (detected.hasExportPath) {
    choices.push({ name: `Keep existing (${detected.exportPath})`, value: "keep" });
  }
  choices.push(
    { name: "Yes, I have the exported file/folder", value: "yes" },
    { name: "No, show me how to export", value: "no" },
  );

  const { hasFile } = await inquirer.default.prompt([{
    type: "list",
    name: "hasFile",
    message: "Do you have Facebook Messenger export data?",
    choices,
  }]);

  if (hasFile === "keep") {
    return { enabled: true, configured: true, dataSource: "file" as const, filePath: detected.exportPath };
  }

  if (hasFile === "yes") {
    const { filePath } = await inquirer.default.prompt([{
      type: "input",
      name: "filePath",
      message: "Path to Facebook Messenger export:",
      validate: (v: string) => {
        if (!v.trim()) return "Path is required";
        if (!existsSync(v.trim())) return `Not found: ${v}`;
        return true;
      },
    }]);
    envUpdates.FACEBOOK_EXPORT_PATH = resolve(filePath.trim());
    return { enabled: true, configured: true, dataSource: "file" as const, filePath: resolve(filePath.trim()) };
  }

  // Show manual guide
  console.log("");
  console.log("  ┌─ How to export Facebook Messenger data ─────────────");
  for (const step of metadata.manualExportGuide) {
    console.log(`  │  ${step}`);
  }
  console.log("  └──────────────────────────────────────────");
  console.log("  ℹ After exporting, run: mirrorai ingest --platform=facebook --file=<path>\n");
  return { enabled: true, configured: false, dataSource: "pending" as const };
}

export default { metadata, detect, setup };
