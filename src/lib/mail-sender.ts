// Envío de avisos masivos: enchufable a un proveedor real cuando se defina
// (cuenta de Gmail/Workspace institucional o un servicio transaccional tipo
// Resend/SendGrid/Mailgun). Hasta entonces, el aviso queda guardado en
// `avisos_enviados` con estado "pendiente" y no se manda nada — el panel
// nunca simula un envío que no ocurrió.

export interface EnvioResultado {
  enviado: boolean;
  detalle: string;
}

export async function enviarAvisoMasivo(
  env: Env,
  destinatarios: string[],
  _asunto: string,
  _cuerpo: string
): Promise<EnvioResultado> {
  if (!env.MAIL_PROVIDER_API_KEY) {
    return {
      enviado: false,
      detalle: `Sin proveedor de mail configurado (falta el secret MAIL_PROVIDER_API_KEY). El aviso quedó guardado para ${destinatarios.length} destinatarios, pero no se envió.`,
    };
  }

  // TODO: cuando se defina el proveedor, implementar el envío real acá
  // (por ejemplo, la API HTTP de Resend/SendGrid/Mailgun, o la API de Gmail
  // si se opta por la cuenta institucional).
  return {
    enviado: false,
    detalle: "Proveedor de mail configurado pero el envío real todavía no está implementado.",
  };
}
