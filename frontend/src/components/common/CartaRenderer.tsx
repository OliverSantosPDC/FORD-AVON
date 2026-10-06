import { forwardRef } from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Render ÚNICO y compartido de una carta de cobro por PD (Gestión, Control
 * Operativo y Configuración > Plantillas lo reutilizan, nadie reimplementa
 * su propia versión). El texto llega YA sustituido por el backend
 * (`renderizarCarta` en CartaPdService.ts) salvo dos anclas de IMAGEN que el
 * backend deja literales a propósito: «Logo» y «Firma» — este componente las
 * reemplaza por la imagen real (si `logoUrl`/`firmaUrl` llegan, es decir, la
 * carta YA está autorizada) o por un recuadro "Pendiente de autorización"
 * (si no). Nunca se muestra logo/firma antes de que el backend los entregue:
 * el gate real es que esas URLs vengan o no desde el backend, no un flag
 * local — así que aunque alguien manipule el estado de este componente, no
 * hay ninguna imagen "autorizada" que mostrar si el backend no la mandó.
 */
interface CartaRendererProps {
  contenido: string;
  logoUrl: string | null;
  firmaUrl: string | null;
  /** Texto mostrado cuando «Firma» no tiene imagen. Por defecto, el de
   *  Gestión/Control Operativo ("Pendiente de autorización": la carta REAL
   *  aún no fue aprobada — null ahí siempre significa eso, nunca otra cosa).
   *  Configuración > Plantillas (Visualizar/Vista previa, que nunca crea ni
   *  aprueba una carta real) pasa un texto distinto: aquí null solo puede
   *  significar "no se eligió supervisor" o "el supervisor elegido no tiene
   *  una imagen de firma subida todavía" — nunca "pendiente de aprobación". */
  firmaPendienteTexto?: string;
}

const Placeholder = ({ texto }: { texto: string }) => (
  <Box
    sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: '1px dashed', borderColor: 'warning.main', borderRadius: 1,
      px: 1.5, py: 0.5, my: 0.5, bgcolor: 'warning.50'
    }}
  >
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'warning.dark', textTransform: 'uppercase' }}>
      {texto}
    </Typography>
  </Box>
);

const CartaRenderer = forwardRef<HTMLDivElement, CartaRendererProps>(({ contenido, logoUrl, firmaUrl, firmaPendienteTexto }, ref) => {
  // Divide el texto en segmentos alrededor de «Logo»/«Firma», preservando el orden real del texto.
  const partes = contenido.split(/(«Logo»|«Firma»)/g);

  return (
    <Box
      ref={ref}
      sx={{
        // Documento tipo carta formal: ancho/alto proporcionales a una hoja
        // Letter, con MÁRGENES DEL CONTENEDOR (nunca saltos de línea en el
        // texto de la plantilla) generosos y uniformes en los 4 lados, para
        // que ningún texto, variable ni la firma queden pegados al borde ni
        // se corten al imprimir/exportar a PDF. Si el contenido es más largo
        // que minHeight, el documento simplemente crece hacia abajo (nunca
        // se recorta); si es más corto, el espacio extra se ve como el
        // margen inferior de una hoja impresa real.
        width: 760,
        minHeight: 980,
        boxSizing: 'border-box',
        mx: 'auto',
        bgcolor: '#fff', color: '#0F172A', fontSize: 13, lineHeight: 1.7,
        whiteSpace: 'pre-wrap', fontFamily: 'Georgia, "Times New Roman", serif',
        padding: '64px 72px 88px 72px'
      }}
    >
      {partes.map((parte, i) => {
        if (parte === '«Logo»') {
          return logoUrl
            ? <Box key={i} component="img" src={logoUrl} alt="Logo" sx={{ height: 64, display: 'block', mb: 3 }} />
            : <Box key={i} sx={{ mb: 3 }}><Placeholder texto="Logo: Pendiente de autorización" /></Box>;
        }
        if (parte === '«Firma»') {
          return firmaUrl
            ? <Box key={i} component="img" src={firmaUrl} alt="Firma" sx={{ height: 64, display: 'block', mt: 2, mb: 1 }} />
            : <Box key={i} sx={{ mt: 2, mb: 1 }}><Placeholder texto={firmaPendienteTexto ?? 'Firma: Pendiente de autorización'} /></Box>;
        }
        return <span key={i}>{parte}</span>;
      })}
    </Box>
  );
});
CartaRenderer.displayName = 'CartaRenderer';

export default CartaRenderer;
