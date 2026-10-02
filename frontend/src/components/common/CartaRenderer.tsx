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
}

const Pendiente = ({ etiqueta }: { etiqueta: string }) => (
  <Box
    sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: '1px dashed', borderColor: 'warning.main', borderRadius: 1,
      px: 1.5, py: 0.5, my: 0.5, bgcolor: 'warning.50'
    }}
  >
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'warning.dark', textTransform: 'uppercase' }}>
      {etiqueta}: Pendiente de autorización
    </Typography>
  </Box>
);

const CartaRenderer = forwardRef<HTMLDivElement, CartaRendererProps>(({ contenido, logoUrl, firmaUrl }, ref) => {
  // Divide el texto en segmentos alrededor de «Logo»/«Firma», preservando el orden real del texto.
  const partes = contenido.split(/(«Logo»|«Firma»)/g);

  return (
    <Box
      ref={ref}
      sx={{
        p: 3, bgcolor: '#fff', color: '#0F172A', fontSize: 13, lineHeight: 1.7,
        whiteSpace: 'pre-wrap', fontFamily: 'Georgia, "Times New Roman", serif', maxWidth: 640
      }}
    >
      {partes.map((parte, i) => {
        if (parte === '«Logo»') {
          return logoUrl
            ? <Box key={i} component="img" src={logoUrl} alt="Logo" sx={{ height: 56, display: 'block', my: 1 }} />
            : <Pendiente key={i} etiqueta="Logo" />;
        }
        if (parte === '«Firma»') {
          return firmaUrl
            ? <Box key={i} component="img" src={firmaUrl} alt="Firma" sx={{ height: 56, display: 'block', my: 1 }} />
            : <Pendiente key={i} etiqueta="Firma" />;
        }
        return <span key={i}>{parte}</span>;
      })}
    </Box>
  );
});
CartaRenderer.displayName = 'CartaRenderer';

export default CartaRenderer;
