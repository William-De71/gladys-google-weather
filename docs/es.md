# Google Weather

## Presentación

Esta integración convierte la **Weather API oficial de Google Maps Platform** en un proveedor meteorológico de Gladys. Una vez instalada, la tarjeta del tiempo del panel, el asistente de chat («¿qué tiempo hará mañana?») y el activador de escena de alerta meteorológica de Gladys la usan en lugar del servicio OpenWeather integrado.

Proporciona:

- el **tiempo actual**: temperatura, sensación térmica, humedad, punto de rocío, presión, viento y rachas, visibilidad, nubosidad, índice UV, día o noche, salida y puesta del sol;
- las **previsiones**: 24 horas y 8 días en el tiempo de Gladys, hasta 10 días en el widget;
- las **alertas públicas oficiales** que Google retransmite (MeteoAlarm para la mayor parte de Europa, el DWD, la NOAA…), en el tiempo de Gladys y en dos activadores de escena;
- cuatro **acciones de escena** y tres **widgets** de panel.

Todo pasa por los servidores de Google (solo nube), con **su propia clave API**: Google factura la Weather API por encima de un uso gratuito mensual, y la integración está pensada para quedarse muy por debajo.

> Esta integración aún no se ha probado con una clave API real: sigue al pie de la letra la documentación de la API. Informe de cualquier problema.

## Requisitos

- Gladys 5.3.0 o posterior.
- Una casa con ubicación (Ajustes → Casas): las alertas se comprueban para cada casa con ubicación.
- Una cuenta de Google y un **proyecto de Google Cloud con una cuenta de facturación**. Google la exige para la Weather API, incluso dentro del uso gratuito.

## Configuración

### 1. Proyecto de Google Cloud y Weather API

1. Abra la [consola de Google Cloud](https://console.cloud.google.com/), cree un proyecto (o elija uno).
2. Vincúlele una cuenta de facturación (Facturación). Sin facturación, todas las solicitudes se rechazan (`BILLING_DISABLED`).
3. Active la **Weather API** (API y servicios → Biblioteca → «Weather API»).

Google también ofrece una «Maps Demo Key» gratuita para probar sin facturación: está reservada a prototipos.

### 2. Clave API y restricciones

1. Google Maps Platform → Claves y credenciales → **Crear credenciales → Clave de API**.
2. Edite la clave: en **Restricciones de API**, elija «Restringir clave» y marque solo **Weather API**. Una clave filtrada no podría usarse entonces para otras API de pago.
3. En **Restricciones de aplicaciones**, elija **Direcciones IP** e introduzca la IP pública de su Gladys si es fija. No use «Sitios web»: las solicitudes salen del contenedor, no de un navegador.
4. Opcional pero recomendable: en Google Maps Platform → Cuotas, reduzca la cuota diaria de la Weather API (por ejemplo 500 al día) como segunda red de seguridad.

### 3. Coste e intervalos de actualización

Google factura cada solicitud correcta (todos los endpoints juntos, SKU «Weather Usage») por encima de **10 000 solicitudes gratuitas al mes**, y luego 0,15 USD por cada 1000 (precios del 17 de octubre de 2026, compruébelos en la [página de precios](https://developers.google.com/maps/documentation/weather/usage-and-billing)). Cada producto se lee como mucho una vez por intervalo y lo comparten el panel, los widgets y las escenas:

| Producto                   | Intervalo por defecto | Solicitudes / mes / casa |
| -------------------------- | --------------------- | ------------------------ |
| Condiciones actuales       | 30 min                | 1488                     |
| Previsión por horas (24 h) | 60 min                | 744                      |
| Previsión diaria (10 días) | 3 × por horas = 3 h   | 248                      |
| Alertas                    | 30 min                | 1488                     |
| **Total (31 días)**        |                       | **3968**                 |

Gladys comprueba el tiempo cada 30 minutos para su propio activador de alertas: intervalos más cortos aportan poco. Cada idioma de panel es una respuesta distinta: dos idiomas duplican el coste. El **Límite mensual de solicitudes** (9000 por defecto) corta toda llamada a Google hasta el mes siguiente una vez alcanzado; se siguen sirviendo las últimas respuestas y el estado de conexión lo indica.

### 4. En Gladys

1. Integraciones → Google Weather → Configuración.
2. Pegue la **clave API**, ajuste los intervalos si hace falta y guarde.
3. Pulse **Probar la clave API**: lee el tiempo actual de su primera casa (una solicitud) y muestra las solicitudes del mes y la estimación mensual.

| Campo                           | Por defecto | Función                                                        |
| ------------------------------- | ----------- | -------------------------------------------------------------- |
| Clave API                       | —           | Su clave (`AIza…`), guardada como secreto                      |
| Condiciones actuales cada (min) | 30          | 10 a 180                                                       |
| Previsión por horas cada (min)  | 60          | 30 a 360; la diaria se lee 3 veces menos                       |
| Alertas oficiales               | sí          | Desactívelas donde Google no publica alertas                   |
| Alertas cada (min)              | 30          | 10 a 180: retraso antes de que una alerta llegue a sus escenas |
| Límite mensual de solicitudes   | 9000        | Red de seguridad                                               |

## Uso

### Tarjeta del tiempo y asistente

Nada que hacer: la tarjeta del tiempo del panel usa este proveedor. Si hay varios proveedores meteorológicos instalados, fije uno en los ajustes de la tarjeta.

### Cobertura, España y Europa

El tiempo actual y las previsiones cubren la mayoría de los países, entre ellos España, Francia, Portugal, Alemania y el resto de Europa. No están disponibles en China, Japón, Corea del Sur, Vietnam, Irán, Corea del Norte, Cuba ni Siria, entre otros: allí la petición falla y Gladys pasa a su siguiente proveedor meteorológico.

Las alertas proceden de los servicios oficiales a través de Google: MeteoAlarm para la mayoría de los países europeos (España incluida; para Francia, la vigilancia de Météo-France), el DWD para Alemania. Canadá, India y Rusia tienen el tiempo pero no alertas: desactívelas allí para ahorrar sus solicitudes. Los colores de MeteoAlarm corresponden a la gravedad: amarillo = moderada, naranja = grave, rojo = extrema. Los títulos y textos de las alertas están en el idioma del emisor cuando este no proporciona el solicitado.

### Widgets

![Ilustración generada de los tres widgets — alertas meteorológicas, previsión 10 días, próximas horas — no es una captura de pantalla](https://raw.githubusercontent.com/William-De71/gladys-google-weather/main/docs/assets/widgets.es.png)

- **Alertas meteorológicas**: contadores por gravedad y luego cada alerta con su zona, su fin, sus instrucciones y un enlace al emisor.
- **Previsión 10 días**: 5, 7 o 10 días con los iconos de Google, máxima y mínima, cielo y probabilidad de lluvia; toque un día para ver el detalle del día y la noche, el índice UV y las horas del sol.
- **Próximas horas**: una curva de las próximas 12 o 24 horas: temperatura y sensación térmica, probabilidad de lluvia, o viento y rachas.

Cada widget tiene un ajuste **Casa** (el nombre exacto de una casa, vacío para la primera con ubicación).

### Activadores de escena

- **Alerta meteorológica emitida**: una alerta oficial cubre ahora una casa. Filtros: casa, tipo de alerta (tormentas, viento, lluvias, inundaciones, nieve / hielo, frío, calor, niebla, costa / mar, incendios / sequía, ciclón / huracán, tornado, sismo / volcán, aire / radiación, otro), gravedad. Variables: título, tipo, gravedad, zona, inicio, fin, descripción, instrucciones, fuente, resumen…
- **Fin de una alerta meteorológica**: la alerta ha expirado o se ha levantado.

La primera comprobación tras un arranque sirve de referencia: las alertas ya en vigor no activan nada. Una alerta reemitida con el mismo tipo y la misma gravedad no vuelve a activar; un cambio de gravedad (de amarillo a naranja) finaliza la antigua y emite la nueva.

### Acciones de escena

- **Obtener las alertas meteorológicas**: número, alerta más grave (título, tipo, gravedad, fin, instrucciones), resumen.
- **Obtener la previsión de un día**: de hoy a dentro de 9 días: máxima, mínima, cielo, probabilidad y cantidad de lluvia, viento, rachas, UV, salida, puesta, resumen.
- **Obtener el tiempo actual**: temperatura, sensación, humedad, presión, viento, UV, nubosidad, cielo, resumen.
- **¿Va a llover?**: en las próximas 3 a 24 horas, a partir de una probabilidad que usted elige: sí o no, desde cuándo, probabilidad máxima, cantidad total, resumen.

### Ejemplos de escenas

- Cuando se **emite una alerta meteorológica** del tipo «Viento» con gravedad «Grave» o «Extrema» → cerrar las persianas y enviar `{{triggerEvent.data.summary}}` a su móvil.
- Cada mañana a las 7:00 → **Obtener la previsión de un día** (hoy) → enviar su resumen en un mensaje.
- Cada tarde a las 20:00 → **¿Va a llover?** (12 horas, desde el 50 %) → si no se espera lluvia, iniciar el riego del jardín.

## Solución de problemas

- **«Google rechazó la clave API (API_KEY_INVALID)»**: la clave es incorrecta o se ha eliminado; cópiela de nuevo desde la consola.
- **SERVICE_DISABLED**: la Weather API no está activada en el proyecto de la clave.
- **BILLING_DISABLED**: el proyecto no tiene ninguna cuenta de facturación vinculada.
- **API_KEY_SERVICE_BLOCKED** o **API_KEY_IP_ADDRESS_BLOCKED**: las restricciones de la clave excluyen la Weather API o la IP de su Gladys (quizá haya cambiado).
- **Nunca hay alertas**: compruebe arriba la cobertura de su país; el widget de alertas indica cuándo están desactivadas.
- **«Presupuesto mensual alcanzado»**: suba el límite o los intervalos; el contador vuelve a empezar el día 1 del mes (UTC). Las cifras de Google (Google Maps Platform → Métricas) son las que cuentan.
- **Sin tiempo para una casa**: está fuera de la cobertura o no tiene ubicación en Gladys.
- Registros: Ajustes → Supervisión → Google Weather. La clave nunca aparece en ellos.
