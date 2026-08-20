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

  const { idToken, alunoIds, titulo, mensagem } = req.body || {};
  if (!idToken || !Array.isArray(alunoIds) || alunoIds.length === 0 || !titulo) {
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
    if (!meSnap.exists) {
      res.status(403).json({ error: "Usuário não encontrado." });
      return;
    }
    const eu = meSnap.data();

    // Só notifica quem é da mesma turma de quem mencionou (ou envolve a própria catequista,
    // que acompanha qualquer turma) — evita notificar gente sem relação nenhuma com quem postou.
    const alvos = (
      await Promise.all(
        alunoIds
          .filter((id) => id && id !== decoded.uid)
          .map((id) => db.collection("usuarios").doc(id).get())
      )
    ).filter((snap) => {
      if (!snap.exists) return false;
      const dados = snap.data();
      return eu.papel === "catequista" || dados.papel === "catequista" || dados.turmaId === eu.turmaId;
    });

    const payload = JSON.stringify({ title: titulo, body: mensagem || "Você foi mencionado(a) na Comunidade.", url: "/" });

    const envios = alvos
      .filter((snap) => snap.data().pushSubscription)
      .map(async (snap) => {
        try {
          await webpush.sendNotification(snap.data().pushSubscription, payload);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.collection("usuarios").doc(snap.id).update({ pushSubscription: admin.firestore.FieldValue.delete() });
          }
        }
      });

    await Promise.allSettled(envios);
    res.status(200).json({ ok: true, tentativas: envios.length });
  } catch (err) {
    res.status(500).json({ error: "Algo deu errado ao enviar a notificação." });
  }
}
