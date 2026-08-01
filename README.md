# Centros de acopio en Xalapa

Este proyecto es un directorio sencillo de centros de acopio en Xalapa. El sitio muestra los centros en un mapa de Leaflet y permite buscar y filtrar por material, modalidad y horario. También puede calcular la distancia desde la ubicación del usuario.

Los datos se editan en `data/centros-acopio.geojson` y el catálogo de materiales en `data/materiales.json`. Cada material usado por un centro debe tener un identificador correspondiente en el catálogo. En GeoJSON las coordenadas se escriben como `[longitud, latitud]`; para Xalapa normalmente se ven como `[-96.x, 19.x]`.

El sitio está hecho únicamente con HTML, CSS y JavaScript. `index.html` contiene la estructura, `css/style.css` controla la apariencia y `js/app.js` carga los datos, crea el mapa y aplica los filtros. No necesita compilación: GitHub Pages puede publicarlo directamente desde la raíz del repositorio.

El proyecto contiene un `package.json` para levantar un servidor local de prueba sin instalar dependencias. Ejecuta `npm start` y abre `http://127.0.0.1:8080`. Conviene usar este servidor en lugar de abrir `index.html` directamente, porque el navegador puede bloquear la carga de los archivos JSON cuando se usa `file://`.
