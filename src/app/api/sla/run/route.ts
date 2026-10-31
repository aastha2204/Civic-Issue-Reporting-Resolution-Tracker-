import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const force = searchParams.get("force") === "1";

    // 1. Enforce 5-minute rate limit via app_settings unless force=1 is specified
    if (!force) {
      const { data: settingData, error: settingErr } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "sla_last_run")
        .maybeSingle();

      if (!settingErr && settingData?.value) {
        const lastRunTime = new Date(settingData.value).getTime();
        if (!isNaN(lastRunTime)) {
          const diffMinutes = (Date.now() - lastRunTime) / (1000 * 60);
          if (diffMinutes < 5) {
            return NextResponse.json({
              skipped: true,
              reason: `SLA escalation ran ${diffMinutes.toFixed(1)} minutes ago (less than 5 minutes). Pass ?force=1 to override.`,
            });
          }
        }
      }
    }

    // 2. Call run_sla_escalation RPC using service_role admin client
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      "run_sla_escalation"
    );

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || "Failed to execute SLA escalation" },
        { status: 500 }
      );
    }

    // 3. Upsert 'sla_last_run' = now() in app_settings
    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "sla_last_run", value: nowIso });

    return NextResponse.json(rpcResult);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
