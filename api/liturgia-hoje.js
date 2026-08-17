import * as cheerio from "cheerio";

function hojeBrasil() {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(new Date());
  const dia = partes.find((p) => p.type === "day").value;
  const mes = partes.find((p) => p.type === "month").value;
  const ano = partes.find((p) => p.type === "year").value;
  return { dia, mes, ano, chave: `${ano}-${mes}-${dia}` };
}

function textoDepoisDoHeading($, heading) {
  const p = heading.nextAll("p").first();
  return p.text().trim();
}

export default async function handler(req, res) {
  const { dia, mes, ano, chave } = hojeBrasil();
  const url = `https://bibliotecacatolica.com.br/blog/liturgia-diaria/${dia}-${mes}-${ano}/`;

  try {
    const resposta = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EmausApp/1.0)" },
    });
    if (!resposta.ok) {
      res.status(502).json({ error: `Fonte retornou ${resposta.status}` });
      return;
    }
    const html = await resposta.text();
    const $ = cheerio.load(html);

    const encontrarHeading = (texto) =>
      $("h2, h3").filter((_, el) => $(el).text().trim().toLowerCase() === texto.toLowerCase()).first();

    const semanaLiturgica = $("p.has-medium-font-size").first().text().trim();

    const leituras = [];
    const primeira = encontrarHeading("Primeira leitura");
    if (primeira.length) leituras.push({ tipo: "Primeira Leitura", referencia: textoDepoisDoHeading($, primeira) });

    const segunda = encontrarHeading("Segunda leitura");
    if (segunda.length) leituras.push({ tipo: "Segunda Leitura", referencia: textoDepoisDoHeading($, segunda) });

    const salmo = encontrarHeading("Salmo");
    if (salmo.length) leituras.push({ tipo: "Salmo", referencia: textoDepoisDoHeading($, salmo) });

    const evangelho = encontrarHeading("Evangelho");
    if (evangelho.length) leituras.push({ tipo: "Evangelho", referencia: textoDepoisDoHeading($, evangelho) });

    const santoHeading = encontrarHeading("Santo do dia");
    const santoDoDia = santoHeading.length ? textoDepoisDoHeading($, santoHeading) : "";

    res.status(200).json({
      dataChave: chave,
      semanaLiturgica,
      leituras,
      santoDoDia,
      fonte: url,
      fonteLabel: "Minha Biblioteca Católica",
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
