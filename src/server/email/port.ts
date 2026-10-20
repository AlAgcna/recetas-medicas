// Puerto de correo saliente.
//
// La aplicación no conoce al proveedor: sólo que hay que entregar un mensaje.
// Hoy la única implementación real es Resend; el prototipo local usa un buzón en
// memoria, igual que el buzón simulado de los códigos.

export type OutgoingEmail = {
  to: string;
  subject: string;
  /** Sólo texto: el portal no envía HTML ni adjuntos por correo. */
  text: string;
};

export type SendEmail = (email: OutgoingEmail) => void | Promise<void>;
