import admin from "firebase-admin";

// Apagar a conta de login de outra pessoa só pode ser feito com privilégio de administrador do
// Firebase — por isso essa operação passa por aqui (servidor) em vez de acontecer direto no app,
// que só tem permissão pra mexer no próprio cadastro de quem está logado.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido" });
    return;
  }

  const { idToken, alunoId } = req.body || {};
  if (!idToken || !alunoId) {
    res.status(400).json({ error: "Dados incompletos." });
    return;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({ error: "Não foi possível confirmar sua identidade. Saia e entre de novo." });
    return;
  }

  const db = admin.firestore();

  try {
    const meSnap = await db.collection("usuarios").doc(decoded.uid).get();
    if (!meSnap.exists || meSnap.data().papel !== "catequista") {
      res.status(403).json({ error: "Só a catequista pode excluir a conta de um catequizando." });
      return;
    }

    if (alunoId === decoded.uid) {
      res.status(400).json({ error: "Use a opção de excluir a própria conta em Meu Perfil." });
      return;
    }

    const alunoSnap = await db.collection("usuarios").doc(alunoId).get();
    if (!alunoSnap.exists || alunoSnap.data().papel !== "aluno") {
      res.status(404).json({ error: "Catequizando não encontrado." });
      return;
    }

    await db.collection("usuarios").doc(alunoId).delete();
    // Se a conta de login já não existir mais no Firebase Auth (ex: já tinha sido excluída antes
    // por algum motivo), ignora o erro — o objetivo é garantir que o cadastro suma de qualquer forma.
    await admin.auth().deleteUser(alunoId).catch(() => {});

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Algo deu errado ao excluir a conta. Tente novamente." });
  }
}
