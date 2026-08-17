export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no servidor" });
    return;
  }

  const { dataISO, dataLabel, jaTemSanto } = req.body || {};
  if (!dataISO || !dataLabel) {
    res.status(400).json({ error: "dataISO e dataLabel são obrigatórios" });
    return;
  }

  const prompt = `Hoje é ${dataLabel} (${dataISO}), no calendário litúrgico católico romano usado no Brasil.
Responda SOMENTE com um JSON puro, sem markdown e sem texto fora do JSON, neste formato exato:
{"celebracao": "", "grau": "", "leituras": [{"tipo": "", "referencia": ""}]}

Regras:
- ${jaTemSanto ? 'O campo "celebracao" pode ficar vazio, pois já sabemos a celebração principal de hoje — foque em preencher "leituras" corretamente.' : 'Em "celebracao", informe o nome do santo ou celebração do dia conforme o calendário romano geral/CNBB, se houver memória; deixe vazio se for dia ferial comum.'}
- Em "leituras", liste os tipos (Primeira Leitura, Salmo, Segunda Leitura quando houver, Evangelho) com a referência bíblica no formato "Livro cap,vers" (ex: "Mt 5,1-12"). NUNCA transcreva o texto bíblico, apenas a referência.
- Se não tiver certeza absoluta da referência exata, ainda assim dê a referência mais provável considerando o tempo litúrgico e o ciclo de leituras — não deixe o campo em branco.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: errText });
      return;
    }

    const json = await response.json();
    const textBlocks = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const clean = textBlocks.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
