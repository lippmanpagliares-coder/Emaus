import admin from "firebase-admin";
import webpush from "web-push";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const VAPID_PUBLIC_KEY = "BA0I9YUsQCK7FZm0mH8S7ZNXTNpuv6592_uap7o2-QhULs8QN7tq8qCIswLWaFRBwBjdNJPJEBhJhXc9qi_AiIQ";

webpush.setVapidDetails(
  "mailto:priscila@blladv.com.br",
  VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY || ""
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido" });
    return;
  }

  const { idToken, turmaId, titulo, mensagem } = req.body || {};
  if (!idToken || !turmaId || !titulo) {
    res.status(400).json({ error: "Dados incompletos." });
    return;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({ error: "Não foi possível confirmar sua identidade." });
    return;
  }

  const db = admin.firestore();

  try {
    const meSnap = await db.collection("usuarios").doc(decoded.uid).get();
    if (!meSnap.exists || meSnap.data().papel !== "catequista") {
      res.status(403).json({ error: "Só a catequista pode enviar avisos pra turma." });
      return;
    }

    const alunosSnap = await db
      .collection("usuarios")
      .where("turmaId", "==", turmaId)
      .where("papel", "==", "aluno")
      .get();

    const payload = JSON.stringify({
      title: titulo,
      body: mensagem || "Nova publicação no mural da turma.",
      url: "/",
    });

    const envios = alunosSnap.docs
      .filter((d) => d.data().pushSubscription)
      .map(async (d) => {
        try {
          await webpush.sendNotification(d.data().pushSubscription, payload);
        } catch (err) {
          // inscrição expirada ou o navegador cancelou — limpa pra não tentar de novo à toa
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.collection("usuarios").doc(d.id).update({ pushSubscription: admin.firestore.FieldValue.delete() });
          }
        }
      });

    await Promise.allSettled(envios);
    res.status(200).json({ ok: true, tentativas: envios.length });
  } catch (err) {
    res.status(500).json({ error: "Algo deu errado ao enviar as notificações." });
  }
}
