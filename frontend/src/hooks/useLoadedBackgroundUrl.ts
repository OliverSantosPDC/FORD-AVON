import { useEffect, useState } from 'react';

/**
 * Resuelve una URL de fondo (Configuración > Apariencia) a un valor usable en
 * `background-image` SOLO después de confirmar que la imagen carga — el
 * equivalente de `onError` de <img>, pero para un fondo CSS, que no dispara
 * ningún evento propio. Si `url` es null, cambia, o falla al cargar (Storage
 * caído, URL firmada expirada, archivo borrado), devuelve null para que el
 * llamador conserve su fondo estático actual — nunca deja la pantalla con un
 * `background-image` roto.
 */
export const useLoadedBackgroundUrl = (url: string | null): string | null => {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setLoadedUrl(null); return undefined; }
    let active = true;
    const img = new Image();
    img.onload = () => { if (active) setLoadedUrl(url); };
    img.onerror = () => { if (active) setLoadedUrl(null); };
    img.src = url;
    return () => { active = false; };
  }, [url]);

  return loadedUrl;
};
