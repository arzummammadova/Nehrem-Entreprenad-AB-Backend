import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:3000" }));
app.use(bodyParser.json());

// 🔹 Hastighetsbegränsning (rate limit)
const ipRequests = new Map();
const RATE_LIMIT_REQUESTS = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 timme

const checkRateLimit = (ip) => {
  const now = Date.now();

  if (!ipRequests.has(ip)) {
    ipRequests.set(ip, { count: 1, firstAttempt: now, blockedUntil: null });
    return { blocked: false };
  }

  const data = ipRequests.get(ip);

  if (data.blockedUntil && data.blockedUntil > now) {
    const remaining = Math.ceil((data.blockedUntil - now) / 60000);
    return { blocked: true, remaining };
  }

  if (now - data.firstAttempt > RATE_LIMIT_WINDOW) {
    ipRequests.set(ip, { count: 1, firstAttempt: now, blockedUntil: null });
    return { blocked: false };
  }

  data.count += 1;
  if (data.count > RATE_LIMIT_REQUESTS) {
    data.blockedUntil = now + RATE_LIMIT_WINDOW;
    ipRequests.set(ip, data);
    return { blocked: true, remaining: 60 };
  }

  ipRequests.set(ip, data);
  return { blocked: false };
};

// 🔹 Validering av formulär
const validateForm = ({ name, email, tel, subject, message }) => {
  const errors = [];

  if (!name || typeof name !== "string") {
    errors.push("Namn krävs.");
  } else if (name.trim().length < 2) {
    errors.push("Namnet måste innehålla minst 2 tecken.");
  } else if (name.trim().length > 100) {
    errors.push("Namnet får inte vara längre än 100 tecken.");
  }

  if (!email || typeof email !== "string") {
    errors.push("E-post krävs.");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push("Ange en giltig e-postadress.");
    } else if (email.length > 254) {
      errors.push("E-postadressen är för lång.");
    }
  }

  if (tel && typeof tel === "string") {
    const telClean = tel.replace(/\D/g, "");
    if (telClean.length < 7 || telClean.length > 15) {
      errors.push("Telefonnumret måste innehålla mellan 7 och 15 siffror.");
    }
  }

  if (!subject || typeof subject !== "string") {
    errors.push("Ämne krävs.");
  } else if (subject.trim().length < 3) {
    errors.push("Ämnet måste innehålla minst 3 tecken.");
  } else if (subject.trim().length > 200) {
    errors.push("Ämnet får inte vara längre än 200 tecken.");
  }

  if (!message || typeof message !== "string") {
    errors.push("Meddelande krävs.");
  } else if (message.trim().length < 10) {
    errors.push("Meddelandet måste innehålla minst 10 tecken.");
  } else if (message.trim().length > 5000) {
    errors.push("Meddelandet får inte vara längre än 5000 tecken.");
  }

  return errors;
};

// 🔹 Sanering av indata
const sanitizeInput = (input) => {
  return input.trim().replace(/[<>]/g, "");
};

// 🔹 API för kontaktformulär
app.post("/api/contact", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  let { name, email, tel, subject, message } = req.body;

  const rateStatus = checkRateLimit(ip);
  if (rateStatus.blocked) {
    return res.status(429).json({
      error: `För många försök. Försök igen om ${rateStatus.remaining} minuter.`,
    });
  }

  name = sanitizeInput(name || "");
  email = sanitizeInput(email || "");
  tel = sanitizeInput(tel || "");
  subject = sanitizeInput(subject || "");
  message = sanitizeInput(message || "");

  const errors = validateForm({ name, email, tel, subject, message });
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      replyTo: email,
      subject: `📧 Nytt meddelande: ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0d9488;">Du har fått ett nytt meddelande</h2>
          <hr style="border: none; border-top: 2px solid #0d9488;">
          
          <p><strong>Namn:</strong> ${name}</p>
          <p><strong>E-post:</strong> <a href="mailto:${email}">${email}</a></p>
          ${tel ? `<p><strong>Telefon:</strong> ${tel}</p>` : ""}
          <p><strong>Ämne:</strong> ${subject}</p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          
          <p><strong>Meddelande:</strong></p>
          <p style="white-space: pre-wrap; background: #f0f9ff; padding: 15px; border-left: 4px solid #0d9488; border-radius: 4px;">
            ${message}
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            IP-adress: ${ip} | Tid: ${new Date().toLocaleString("sv-SE")}
          </p>
        </div>
      `,
      text: `
        Namn: ${name}
        E-post: ${email}
        Telefon: ${tel || "—"}
        Ämne: ${subject}
        Meddelande: ${message}
      `,
    };

    await transporter.sendMail(mailOptions);

    console.log(`✅ Meddelande mottaget | ${email} (IP: ${ip}) | Tid: ${new Date().toISOString()}`);

    return res.status(200).json({
      success: true,
      message: "Ditt meddelande har skickats framgångsrikt!",
    });
  } catch (error) {
    console.error("❌ E-postfel:", error);
    return res.status(500).json({
      error: "Meddelandet kunde inte skickas. Försök igen senare.",
    });
  }
});

// Hälsokontroll
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Serverstart
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Servern körs på port ${PORT}`);
  console.log(`🌐 CORS-origin: ${process.env.CLIENT_URL || "http://localhost:3000"}`);
});
