import * as cheerio from "cheerio";

function dataBrasil(offsetDias) {
  const alvo = new Date(Date.now() - offsetDias * 86400000);
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(alvo);
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

// A fonte às vezes demora alguns dias para publicar a página do dia — tenta
// hoje e, se ainda não existir, volta dia a dia até achar a edição mais
// recente já publicada (deixando claro pro cliente qual data foi usada).
const MAX_DIAS_ATRAS = 5;

function extrairLiturgia($, dataChave, dataFonte, url) {
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

  if (leituras.length === 0) return null;

  return { dataChave, dataFonte, semanaLiturgica, leituras, santoDoDia: santoDoDia($), fonte: url, fonteLabel: "Minha Biblioteca Católica" };
}

// O site às vezes gera o LINK da página com o mês errado (ex: a edição de 08/09 sai publicada
// em ".../08-08-26-2/") — não dá pra confiar em adivinhar a URL pela data. O título do post,
// porém, é sempre exatamente "Liturgia Diária DD/MM/AA", então buscamos pela API própria do
// site (WordPress) por esse título, que devolve o conteúdo certo mesmo com o link bugado.
async function buscarPorTitulo(dia, mes, ano, dataChave, dataFonte) {
  const titulo = `Liturgia Diária ${dia}/${mes}/${ano}`;
  const apiUrl = `https://bibliotecacatolica.com.br/wp-json/wp/v2/posts?search=${encodeURIComponent(titulo)}`;
  const resposta = await fetch(apiUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EmausApp/1.0)" } });
  if (!resposta.ok) return null;
  const posts = await resposta.json();
  const post = Array.isArray(posts) ? posts.find((p) => p.title?.rendered === titulo) : null;
  if (!post) return null;
  const $ = cheerio.load(post.content?.rendered || "");
  return extrairLiturgia($, dataChave, dataFonte, post.link);
}

async function buscarPorUrl(url, dataChave, dataFonte) {
  const resposta = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EmausApp/1.0)" } });
  if (!resposta.ok) return null;
  const html = await resposta.text();
  return extrairLiturgia(cheerio.load(html), dataChave, dataFonte, url);
}

export default async function handler(req, res) {
  const { chave: dataChave } = dataBrasil(0);

  for (let offset = 0; offset <= MAX_DIAS_ATRAS; offset++) {
    const { dia, mes, ano, chave: dataFonte } = dataBrasil(offset);

    try {
      const viaTitulo = await buscarPorTitulo(dia, mes, ano, dataChave, dataFonte);
      if (viaTitulo) {
        res.status(200).json(viaTitulo);
        return;
      }
    } catch {
      // cai pra tentativa por URL adivinhada
    }

    // Reserva, caso a API do site mude ou fique fora do ar — a fonte já teve dois padrões de
    // link diferentes no passado, então tenta os dois.
    const candidatos = [
      `https://bibliotecacatolica.com.br/blog/liturgia-diaria/liturgia-diaria-${dia}-${mes}-${ano}/`,
      `https://bibliotecacatolica.com.br/blog/liturgia-diaria/${dia}-${mes}-${ano}/`,
    ];
    for (const url of candidatos) {
      try {
        const resultado = await buscarPorUrl(url, dataChave, dataFonte);
        if (resultado) {
          res.status(200).json(resultado);
          return;
        }
      } catch {
        // tenta o próximo formato de link, ou o dia anterior
      }
    }

    // A fonte principal ainda não publicou a edição de hoje — antes de voltar pra uma edição
    // de dias atrás, tenta uma segunda fonte (Canção Nova) que costuma estar em dia. Só faz
    // sentido pra data de hoje: se ela também não tiver, segue voltando dias na fonte principal.
    if (offset === 0) {
      try {
        const resultado = await tentarCancaoNova(dataChave);
        if (resultado) {
          res.status(200).json(resultado);
          return;
        }
      } catch {
        // segue pro próximo dia na fonte principal
      }
    }
  }

  res.status(502).json({ error: "Fonte ainda não publicou nenhuma edição recente" });
}

const MAPA_TIPO_CANCAO_NOVA = { "1ª Leitura": "Primeira Leitura", "2ª Leitura": "Segunda Leitura" };

async function tentarCancaoNova(dataChave) {
  const url = "https://liturgia.cancaonova.com/pb/";
  const resposta = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EmausApp/1.0)" },
  });
  if (!resposta.ok) return null;

  const html = await resposta.text();
  const $ = cheerio.load(html);

  const leituras = [];
  $("#leituraTab li").each((_, li) => {
    const tipoOriginal = $(li).find(".tipo-titulo").first().text().trim();
    const referencia = $(li).find(".referencia").first().text().trim();
    if (tipoOriginal && referencia) {
      leituras.push({ tipo: MAPA_TIPO_CANCAO_NOVA[tipoOriginal] || tipoOriginal, referencia });
    }
  });
  // Sem leituras extraídas, a página não veio no formato esperado — melhor não confiar nela.
  if (leituras.length === 0) return null;

  return {
    dataChave,
    dataFonte: dataChave,
    // Essa fonte não separa "semana litúrgica" nem "santo do dia" da mesma forma que a
    // principal — deixa em branco em vez de arriscar mostrar algo incorreto ou incompleto.
    semanaLiturgica: "",
    leituras,
    santoDoDia: "",
    fonte: url,
    fonteLabel: "Liturgia Diária — Canção Nova",
  };
}
