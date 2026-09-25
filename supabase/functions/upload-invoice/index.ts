import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("FIVEMANAGE_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "FIVEMANAGE_API_KEY belum diatur di Supabase." }, 500);
  }

  try {
    const incomingForm = await request.formData();
    const file = incomingForm.get("file");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "File invoice tidak ditemukan." }, 400);
    }

    if (!file.type.startsWith("image/")) {
      return jsonResponse({ error: "File harus berupa gambar." }, 400);
    }

    if (file.size > 10 * 1024 * 1024) {
      return jsonResponse({ error: "Ukuran file maksimal 10 MB." }, 413);
    }

    const formData = new FormData();
    formData.append("file", file, file.name);

    const uploadResponse = await fetch("https://api.fivemanage.com/api/v3/file", {
      method: "POST",
      headers: { Authorization: apiKey },
      body: formData
    });

    const result = await uploadResponse.json();
    if (!uploadResponse.ok || !result?.data?.url) {
      return jsonResponse({
        error: result?.message || "FiveManage menolak upload file."
      }, uploadResponse.status || 502);
    }

    return jsonResponse({
      id: result.data.id,
      url: result.data.url
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Terjadi kesalahan saat mengunggah invoice." }, 500);
  }
});
