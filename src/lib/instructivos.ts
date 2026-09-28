// Contenido de "Instructivos", tomado tal cual del Google Sites de la
// Subsecretaría (presupuestomoron): cada guía es un PDF en el Drive de
// Presupuesto y, en algunos casos, un video en YouTube. Para sumar o cambiar
// una guía alcanza con editar esta lista.

export interface Material {
  tipo: "pdf" | "video";
  titulo: string;
  /** id del archivo de Drive (pdf) o del video de YouTube. */
  id: string;
}

export interface Instructivo {
  slug: string;
  grupo: "Presupuesto por Programas" | "Formulación" | "Trimestrales" | "Ejecución";
  menu: string;
  titulo: string;
  codigo: string;
  resumen: string;
  texto: string[];
  materiales: Material[];
  enlaces?: { href: string; label: string }[];
}

export const INSTRUCTIVOS: Instructivo[] = [
  {
    slug: "introduccion",
    grupo: "Presupuesto por Programas",
    menu: "Introducción (PPP)",
    titulo: "Presupuesto por Programas",
    codigo: "PPP",
    resumen: "El marco conceptual de todos los formularios: cómo se estructura el Presupuesto y qué es un programa.",
    texto: [
      "La técnica de Presupuesto por Programas (PPP) representa el marco conceptual para la formulación del Presupuesto. Entenderla ayuda a comprender cómo se conforma la estructura del Presupuesto y los pasos que se siguen tanto durante su confección como en su seguimiento trimestral.",
      "La PPP es la base para la elaboración de todos los formularios de Presupuesto. A distintos niveles de la estructura y distintos tipos de categorías presupuestarias les corresponde cargar distintos formularios.",
    ],
    materiales: [{ tipo: "pdf", titulo: "Presupuesto por programas", id: "16pO8jfQ5qAK4RmAbibd8YDq1TW8KSstM" }],
  },
  {
    slug: "f1",
    grupo: "Formulación",
    menu: "F1 · Políticas presupuestarias",
    titulo: "Políticas Presupuestarias de la Jurisdicción",
    codigo: "F1",
    resumen: "Formulario 1 de la formulación anual: las políticas presupuestarias de cada jurisdicción.",
    texto: [
      "Instructivo del Formulario 1, que se presenta durante la formulación del Presupuesto. Para entender qué formularios le corresponden a cada nivel de la estructura, consultá primero la introducción al Presupuesto por Programas.",
    ],
    materiales: [{ tipo: "pdf", titulo: "Formulario 1", id: "1Si-7_yK8kgcgRa3FSF9j_Ph69h5RSNvI" }],
  },
  {
    slug: "f4-f5",
    grupo: "Formulación",
    menu: "F4/F5 · Formularios de programa",
    titulo: "Formularios de Programa",
    codigo: "F4/F5",
    resumen: "Formularios 4 y 5: los formularios que carga cada programa en la formulación anual.",
    texto: ["Instructivo de los Formularios 4 y 5, los formularios de programa de la formulación anual."],
    materiales: [{ tipo: "pdf", titulo: "Formularios de programa", id: "1fDDzN3_J4qLXVaQam-TqMCMBZiocMVge" }],
  },
  {
    slug: "f7",
    grupo: "Formulación",
    menu: "F7 · Compra de bienes y servicios",
    titulo: "Compra de Bienes y Servicios",
    codigo: "F7",
    resumen: "Formulario 7: programación anual de compras de bienes y contrataciones de servicios.",
    texto: ["Instructivo del Formulario 7, la programación anual de compras de bienes y contrataciones de servicios de cada categoría programática."],
    materiales: [{ tipo: "pdf", titulo: "Formulario 7", id: "1zCR1LzOgnSxh8HUvhcY0uOttOJnzaCd4" }],
  },
  {
    slug: "f17",
    grupo: "Trimestrales",
    menu: "F17 · Programación del compromiso",
    titulo: "Programación Financiera del Compromiso",
    codigo: "F17",
    resumen: "Formulario 17, que se presenta cada trimestre: cómo distribuir el compromiso de cada partida.",
    texto: [
      "El instructivo del Formulario 17 explica una confección 100% manual del formulario. Gran parte de la recopilación de información puede ahorrarse usando el F17 prellenado de esta página, que ya trae el crédito vigente, el compromiso del año anterior y el de los trimestres ya ejecutados.",
      "El prellenado no reemplaza la carga del formulario en RAFAM: sirve como plantilla para distribuir las partidas en los trimestres que faltan y después cargarlas a mano en RAFAM.",
    ],
    materiales: [
      { tipo: "pdf", titulo: "Instructivo del Formulario 17", id: "1JV-ACFt-_AlOCDwbExMu6yE3C6pqPsDT" },
      { tipo: "video", titulo: "Ejemplo de carga · Primer trimestre", id: "5F0VudtuIQ8" },
    ],
    enlaces: [{ href: "/formulario-17", label: "Abrir el F17 prellenado" }],
  },
  {
    slug: "ejecutado-de-gastos",
    grupo: "Ejecución",
    menu: "Ejecutado de gastos",
    titulo: "Ejecutado de Gastos",
    codigo: "EJ",
    resumen: "Cómo obtener en RAFAM la ejecución presupuestaria partida por partida.",
    texto: [
      "El Ejecutado de Gastos permite obtener la ejecución presupuestaria partida por partida, filtrando según el rango de fechas, la fuente y la estructura deseada.",
    ],
    materiales: [{ tipo: "video", titulo: "Ejecutado de gastos en RAFAM", id: "j_Bzdi5fIEY" }],
  },
];

export const GRUPOS = ["Presupuesto por Programas", "Formulación", "Trimestrales", "Ejecución"] as const;

export const driveVer = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const drivePreview = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;
export const youtubeVer = (id: string) => `https://www.youtube.com/watch?v=${id}`;
