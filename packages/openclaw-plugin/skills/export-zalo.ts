/**
 * MirrorAI — export-zalo Skill.
 * Auto-export Zalo chat history via Zalo API / QR login.
 */




// ─── OpenClaw Export Skill Metadata ─────────────────────────────────────────
export const metadata = {
  id: "zalo",
  displayName: "Zalo",
  icon: "💬",
  status: "ready" as const,
  hasAutoExport: true,
  hasBotReply: true,
  manualExportGuide: [] as string[],
  envKeys: ["ZALO_BOT_TOKEN"],
};

/** Detect existing Zalo config */
export function detect(env: Record<string, string>, _home: string) {
  const token = env.ZALO_BOT_TOKEN || "";
  return {
    hasSession: false,
    hasExportData: false,
    exportMsgCount: 0,
    exportChats: 0,
    hasBotToken: token.length > 5,
    botTokenMasked: token.length > 5 ? token.slice(0, 6) + "***" : "",
    hasExportPath: false,
    exportPath: "",
    selfName: "",
  };
}

/** Interactive setup prompts for Zalo */
export async function setup(inquirer: any, ctx: {
  env: Record<string, string>;
  envUpdates: Record<string, string>;
  detected: ReturnType<typeof detect>;
}) {
  const { envUpdates } = ctx;

  const { zaloSource } = await inquirer.default.prompt([{
    type: "list",
    name: "zaloSource",
    message: "How to get Zalo data?",
    choices: [
      { name: "Personal account — QR login (recommended)", value: "qr" },
      { name: "Bot API token", value: "bot" },
    ],
  }]);

  if (zaloSource === "bot") {
    const { token } = await inquirer.default.prompt([{
      type: "input",
      name: "token",
      message: "Zalo Bot Token:",
      validate: (v: string) => v.trim().length > 5 || "Token looks too short",
    }]);
    envUpdates.ZALO_BOT_TOKEN = token.trim();
  }

  return { enabled: true, configured: true, dataSource: "auto" as const };
}

/** Run auto-export for Zalo */
export async function autoExport(_env: Record<string, string>, _projectRoot: string): Promise<boolean> {
  console.log("\n  ── Zalo Auto-Export ──────────────────────");
  console.log("  ℹ Run: mirrorai export --platform=zalo");
  console.log("  (QR login will be prompted)\n");
  return false;
}

export default { metadata, detect, setup, autoExport };
