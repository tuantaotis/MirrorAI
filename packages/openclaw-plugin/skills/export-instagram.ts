/**
 * MirrorAI — export-instagram Skill.
 * Manual export guide for Instagram DMs data.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── OpenClaw Export Skill Metadata ─────────────────────────────────────────
export const metadata = {
  id: "instagram",
  displayName: "Instagram DMs",
  icon: "📸",
  status: "manual" as const,
  hasAutoExport: false,
  hasBotReply: false,
  manualExportGuide: [
    "1. Go to: Instagram → Settings → Privacy & Security",
    "2. Click 'Request Download' → Format: JSON",
    "3. Wait for email → download ZIP → extract",
  ],
  envKeys: ["INSTAGRAM_EXPORT_PATH"],
};

/** Detect existing Instagram config */
export function detect(env: Record<string, string>, _home: string) {
  const exportPath = env.INSTAGRAM_EXPORT_PATH || "";
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
    message: "Do you have Instagram DMs export data?",
    choices,
  }]);

  if (hasFile === "keep") {
    return { enabled: true, configured: true, dataSource: "file" as const, filePath: detected.exportPath };
  }

  if (hasFile === "yes") {
    const { filePath } = await inquirer.default.prompt([{
      type: "input",
      name: "filePath",
      message: "Path to Instagram DMs export:",
      validate: (v: string) => {
        if (!v.trim()) return "Path is required";
        if (!existsSync(v.trim())) return `Not found: ${v}`;
        return true;
      },
    }]);
    envUpdates.INSTAGRAM_EXPORT_PATH = resolve(filePath.trim());
    return { enabled: true, configured: true, dataSource: "file" as const, filePath: resolve(filePath.trim()) };
  }

  console.log("");
  console.log("  ┌─ How to export Instagram DMs data ─────────────");
  for (const step of metadata.manualExportGuide) {
    console.log(`  │  ${step}`);
  }
  console.log("  └──────────────────────────────────────────");
  console.log("  ℹ After exporting, run: mirrorai ingest --platform=instagram --file=<path>\n");
  return { enabled: true, configured: false, dataSource: "pending" as const };
}

export default { metadata, detect, setup };
