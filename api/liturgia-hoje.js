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
  return { dia, mes, ano, chave: `20${ano}-${mes}-${dia}` };
}

function referenciaDoHeading($, id) {
  const heading = $(`#${id}`);
  if (!heading.length) return "";
  return heading.nextAll("p").first().text().trim();
}

function nomeLimpo(texto) {
  // Mantém só o nome do santo, sem o descritivo em minúsculo ("...,  santo e mártir")
  // nem a data entre parênteses ("(c. 287–305)").
  return texto
    .replace(/\([^)]*\)/g, "")
    .split(",")[0]
    .trim();
}

function santoDoDia($) {
  const heading = $("#santo-do-dia");
  if (!heading.length) return "";
  const proximo = heading.nextAll("p, ul").first();
  if (proximo.is("ul")) {
    return proximo.find("li").map((_, li) => nomeLimpo($(li).text())).get().join("; ");
  }
  return nomeLimpo(proximo.text());
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

    const introHtml = $("p.has-medium-font-size").first().html() || "";
    const partesIntro = introHtml.split(/<br\s*\/?>/i);
    const semanaLiturgica = cheerio.load(partesIntro[partesIntro.length - 1] || "").text().trim();

    const leituras = [];
    const primeira = referenciaDoHeading($, "primeira-leitura");
    if (primeira) leituras.push({ tipo: "Primeira Leitura", referencia: primeira });

    const segunda = referenciaDoHeading($, "segunda-leitura");
    if (segunda) leituras.push({ tipo: "Segunda Leitura", referencia: segunda });

    const salmo = referenciaDoHeading($, "salmo");
    if (salmo) leituras.push({ tipo: "Salmo", referencia: salmo });

    const evangelho = referenciaDoHeading($, "evangelho");
    if (evangelho) leituras.push({ tipo: "Evangelho", referencia: evangelho });

    res.status(200).json({
      dataChave: chave,
      semanaLiturgica,
      leituras,
      santoDoDia: santoDoDia($),
      fonte: url,
      fonteLabel: "Minha Biblioteca Católica",
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
