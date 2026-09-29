// Cliente SMTP mínimo para mandar los mails desde la casilla institucional
// (Zimbra/Postfix de mail.moron.gob.ar) usando los sockets TCP de Cloudflare
// Workers. Una sola conexión por tanda: AUTH una vez y un MAIL FROM/RCPT/DATA
// por destinatario, así cada mail lleva su propio enlace de baja.
//
// Se importa de forma diferida (ver mail-sender.ts): `cloudflare:sockets` solo
// existe dentro del Worker, no en `astro dev`.

import { connect } from "cloudflare:sockets";
import type { Mensaje } from "./mail-sender";

export interface SmtpConfig {
  host: string;
  port: number;
  /** "tls" = TLS directo (465); "starttls" = texto plano + STARTTLS (587); "none" solo para pruebas locales. */
  seguridad: "tls" | "starttls" | "none";
  usuario: string;
  clave: string;
  /** Nombre que se muestra como remitente. */
  nombre: string;
}

const enc = new TextEncoder();
const TIMEOUT_MS = 20_000;

function b64(texto: string): string {
  const bytes = enc.encode(texto);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64Lineas = (texto: string) => b64(texto).replace(/.{1,76}/g, "$&\r\n");
const encabezado = (texto: string) => (/^[\x20-\x7e]*$/.test(texto) ? texto : `=?UTF-8?B?${b64(texto)}?=`);

class Conexion {
  private socket: Socket;
  private lector!: ReadableStreamDefaultReader<Uint8Array>;
  private escritor!: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private dec = new TextDecoder();

  constructor(socket: Socket) {
    this.socket = socket;
    this.enlazar();
  }

  private enlazar() {
    this.lector = this.socket.readable.getReader();
    this.escritor = this.socket.writable.getWriter();
  }

  /** Lee una respuesta completa (varias líneas "250-..." hasta "250 ..."). */
  async respuesta(): Promise<{ codigo: number; texto: string }> {
    const limite = Date.now() + TIMEOUT_MS;
    for (;;) {
      const lineas = this.buffer.split("\r\n");
      for (let i = 0; i < lineas.length - 1; i++) {
        if (/^\d{3} /.test(lineas[i])) {
          const texto = lineas.slice(0, i + 1).join("\n");
          this.buffer = lineas.slice(i + 1).join("\r\n");
          return { codigo: Number(lineas[i].slice(0, 3)), texto };
        }
      }
      const resto = limite - Date.now();
      if (resto <= 0) throw new Error("El servidor de mail no respondió a tiempo");
      const leido = await Promise.race([
        this.lector.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("El servidor de mail no respondió a tiempo")), resto)),
      ]);
      if (leido.done) throw new Error("El servidor de mail cerró la conexión");
      this.buffer += this.dec.decode(leido.value, { stream: true });
    }
  }

  async escribir(texto: string) {
    await this.escritor.write(enc.encode(texto));
  }

  /** Manda un comando y exige uno de los códigos esperados. */
  async comando(linea: string, esperados: number[], mostrar = linea): Promise<string> {
    await this.escribir(`${linea}\r\n`);
    const r = await this.respuesta();
    if (!esperados.includes(r.codigo)) throw new Error(`«${mostrar}» -> ${r.texto}`);
    return r.texto;
  }

  async pasarATls() {
    this.lector.releaseLock();
    this.escritor.releaseLock();
    this.socket = this.socket.startTls();
    this.enlazar();
  }

  async cerrar() {
    try {
      await this.escribir("QUIT\r\n");
    } catch {
      /* ya cerrada */
    }
    try {
      await this.socket.close();
    } catch {
      /* ídem */
    }
  }
}

function armarDatos(cfg: SmtpConfig, m: Mensaje): string {
  const limite = `f17-${crypto.randomUUID()}`;
  const dominio = cfg.usuario.split("@")[1] ?? "moron.gob.ar";
  const cabeceras = [
    `From: ${encabezado(cfg.nombre)} <${cfg.usuario}>`,
    `To: <${m.to}>`,
    `Subject: ${encabezado(m.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${dominio}>`,
    "MIME-Version: 1.0",
    ...(m.baja ? [`List-Unsubscribe: <${m.baja}>`] : []),
    `Content-Type: multipart/alternative; boundary="${limite}"`,
  ];
  const cuerpo = [
    `--${limite}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lineas(m.text),
    `--${limite}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lineas(m.html),
    `--${limite}--`,
    "",
  ];
  // Con base64 ninguna línea empieza con "." (no hace falta el dot-stuffing).
  return [...cabeceras, "", ...cuerpo].join("\r\n");
}

export async function enviarSmtp(cfg: SmtpConfig, mensajes: Mensaje[]): Promise<{ enviados: number; errores: string[] }> {
  const errores: string[] = [];
  let enviados = 0;
  const socket = connect(
    { hostname: cfg.host, port: cfg.port },
    { secureTransport: cfg.seguridad === "tls" ? "on" : cfg.seguridad === "starttls" ? "starttls" : "off", allowHalfOpen: false }
  );
  const c = new Conexion(socket);
  try {
    const saludo = await c.respuesta();
    if (saludo.codigo !== 220) throw new Error(`Saludo inesperado: ${saludo.texto}`);
    const yo = "formulario-17.moron.gob.ar";
    await c.comando(`EHLO ${yo}`, [250]);
    if (cfg.seguridad === "starttls") {
      await c.comando("STARTTLS", [220]);
      await c.pasarATls();
      await c.comando(`EHLO ${yo}`, [250]);
    }
    await c.comando(`AUTH PLAIN ${b64(`\0${cfg.usuario}\0${cfg.clave}`)}`, [235], "AUTH PLAIN (usuario y contraseña)");

    for (const m of mensajes) {
      try {
        await c.comando(`MAIL FROM:<${cfg.usuario}>`, [250]);
        await c.comando(`RCPT TO:<${m.to}>`, [250, 251]);
        await c.comando("DATA", [354]);
        await c.escribir(armarDatos(cfg, m));
        await c.comando(".", [250], "fin del mensaje");
        enviados++;
      } catch (e) {
        errores.push(`${m.to}: ${e instanceof Error ? e.message : e}`);
        await c.comando("RSET", [250]).catch(() => undefined);
      }
    }
  } catch (e) {
    errores.push(`Servidor de mail: ${e instanceof Error ? e.message : e}`);
  } finally {
    await c.cerrar();
  }
  return { enviados, errores };
}
