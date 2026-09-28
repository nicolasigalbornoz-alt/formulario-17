/**
 * Envío de los avisos de la lista de difusión del sitio de Presupuesto.
 *
 * Se publica UNA vez, con la cuenta desde la que tienen que salir los mails
 * (por ejemplo la de la Dirección de Presupuesto):
 *
 *  1. https://script.google.com -> Nuevo proyecto. Borrar lo que trae y pegar
 *     este archivo.
 *  2. En TOKEN poner una clave larga inventada (no subirla a ningún repo). La
 *     misma clave va en el secret MAIL_TOKEN del sitio.
 *  3. Implementar -> Nueva implementación -> Aplicación web.
 *     Ejecutar como: "Yo". Quién tiene acceso: "Cualquier usuario".
 *     Autorizar el envío de mails cuando lo pida y copiar la URL (termina en /exec).
 *  4. En el sitio: MAIL_PROVIDER=apps_script, MAIL_APPS_SCRIPT_URL=<esa URL>,
 *     MAIL_TOKEN=<la clave>.
 *
 * Si se cambia el código: Implementar -> Gestionar implementaciones -> editar
 * -> Versión: nueva versión (así la URL sigue siendo la misma).
 *
 * Límites de Google (por día): 100 destinatarios con una cuenta @gmail.com,
 * 1.500 con Google Workspace. MailApp.getRemainingDailyQuota() dice cuántos
 * quedan hoy.
 */

var TOKEN = "CAMBIAR-POR-UNA-CLAVE-LARGA";

function doPost(e) {
  var datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return respuesta({ ok: false, error: "JSON inválido" });
  }
  if (!datos || datos.token !== TOKEN) return respuesta({ ok: false, error: "Token inválido" });

  var mensajes = datos.mensajes || [];
  var quedan = MailApp.getRemainingDailyQuota();
  if (quedan < mensajes.length) {
    return respuesta({
      ok: false,
      error: "Cuota diaria de Google insuficiente: quedan " + quedan + " envíos y se pidieron " + mensajes.length + ".",
    });
  }

  var enviados = 0;
  var errores = [];
  for (var i = 0; i < mensajes.length; i++) {
    var m = mensajes[i];
    try {
      MailApp.sendEmail({
        to: m.to,
        subject: m.subject,
        body: m.text,
        htmlBody: m.html,
        name: datos.nombre || "Dirección de Presupuesto",
      });
      enviados++;
    } catch (err) {
      errores.push(m.to + ": " + err.message);
    }
  }
  return respuesta({ ok: true, enviados: enviados, errores: errores });
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
