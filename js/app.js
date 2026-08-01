"use strict";

const XALAPA_CENTER = [19.5438, -96.9236];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SERVICE_LABELS = {
  barter: "Trueque",
  purchase: "Compra",
  donation: "Donación",
  other: "Otro servicio",
};

const elements = {
  filtersForm: document.getElementById("filtersForm"),
  searchInput: document.getElementById("searchInput"),
  materialSelect: document.getElementById("materialSelect"),
  daySelect: document.getElementById("daySelect"),
  serviceSelect: document.getElementById("serviceSelect"),
  openNowCheckbox: document.getElementById("openNowCheckbox"),
  clearFiltersButton: document.getElementById("clearFiltersButton"),
  locationButton: document.getElementById("locationButton"),
  locationStatus: document.getElementById("locationStatus"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsList: document.getElementById("resultsList"),
  emptyStateTemplate: document.getElementById("emptyStateTemplate"),
  mapPanel: document.querySelector(".map-panel"),
};

const state = {
  features: [],
  materials: [],
  materialsById: new Map(),
  markerById: new Map(),
  approximateMarkerLayouts: [],
  approximateLocationIcon: null,
  userLocation: null,
  userMarker: null,
  accuracyCircle: null,
};

let map;
let markerLayer;

initialize();

async function initialize() {
  if (typeof window.L === "undefined") {
    showLoadError("No se pudo cargar el mapa. Revisa tu conexión e intenta de nuevo.");
    return;
  }

  initializeMap();
  bindEvents();

  try {
    const [materials, geojson] = await Promise.all([
      fetchJson("data/materiales.json"),
      fetchJson("data/centros-acopio.geojson"),
    ]);

    state.materials = materials;
    state.materialsById = new Map(materials.map((material) => [material.id, material]));
    state.features = geojson.features.filter(hasValidPointGeometry);

    populateMaterialFilter();
    createMarkers();
    applyFilters({ fitMap: true });
    elements.resultsList.setAttribute("aria-busy", "false");
  } catch (error) {
    console.error(error);
    showLoadError("No se pudieron cargar los datos de los centros de acopio.");
  }
}

function initializeMap() {
  map = L.map("map", {
    zoomControl: true,
  }).setView(XALAPA_CENTER, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; colaboradores de OpenStreetMap",
  }).addTo(map);

  markerLayer = L.featureGroup().addTo(map);
  map.on("zoomend", updateApproximateMarkerPositions);
  state.approximateLocationIcon = L.divIcon({
    className: "approximate-marker",
    html: '<span aria-hidden="true">≈</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -15],
  });
}

function bindEvents() {
  elements.filtersForm.addEventListener("submit", (event) => event.preventDefault());
  elements.searchInput.addEventListener("input", () => applyFilters({ fitMap: false }));
  elements.materialSelect.addEventListener("change", () => applyFilters({ fitMap: true }));
  elements.daySelect.addEventListener("change", () => applyFilters({ fitMap: true }));
  elements.serviceSelect.addEventListener("change", () => applyFilters({ fitMap: true }));
  elements.openNowCheckbox.addEventListener("change", () => applyFilters({ fitMap: true }));
  elements.clearFiltersButton.addEventListener("click", clearFilters);
  elements.locationButton.addEventListener("click", requestUserLocation);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${path}: ${response.status}`);
  }
  return response.json();
}

function hasValidPointGeometry(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2) {
    return false;
  }

  const [longitude, latitude] = coordinates;
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90;
}

function populateMaterialFilter() {
  const grouped = new Map();
  const sortedMaterials = [...state.materials].sort((first, second) => (
    first.category.localeCompare(second.category, "es")
    || first.name.localeCompare(second.name, "es")
  ));

  for (const material of sortedMaterials) {
    if (!grouped.has(material.category)) grouped.set(material.category, []);
    grouped.get(material.category).push(material);
  }

  for (const [category, materials] of grouped) {
    const group = document.createElement("optgroup");
    group.label = category;

    for (const material of materials) {
      const option = document.createElement("option");
      option.value = material.id;
      option.textContent = material.name;
      group.append(option);
    }

    elements.materialSelect.append(group);
  }
}

function createMarkers() {
  const approximateGroups = new Map();
  state.approximateMarkerLayouts = [];

  for (const feature of state.features) {
    if (feature.properties.locationPrecision !== "city") continue;
    const coordinateKey = feature.geometry.coordinates.join(",");
    if (!approximateGroups.has(coordinateKey)) approximateGroups.set(coordinateKey, []);
    approximateGroups.get(coordinateKey).push(feature);
  }

  for (const feature of state.features) {
    const [longitude, latitude] = feature.geometry.coordinates;
    const isApproximate = feature.properties.locationPrecision === "city";
    let markerPosition = L.latLng(latitude, longitude);

    if (isApproximate) {
      const coordinateKey = feature.geometry.coordinates.join(",");
      const group = approximateGroups.get(coordinateKey) || [];
      if (group.length > 1) {
        const index = group.findIndex((item) => item.id === feature.id);
        const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / group.length);
        const layout = {
          featureId: feature.id,
          basePosition: L.latLng(latitude, longitude),
          angle,
        };
        state.approximateMarkerLayouts.push(layout);
        markerPosition = getSpreadMarkerPosition(layout);
      }
    }

    const markerOptions = {
      title: isApproximate
        ? `${feature.properties.name} (ubicación aproximada)`
        : feature.properties.name,
      alt: isApproximate
        ? `Cobertura aproximada: ${feature.properties.name}`
        : `Centro de acopio: ${feature.properties.name}`,
    };
    if (isApproximate) markerOptions.icon = state.approximateLocationIcon;

    const marker = L.marker(markerPosition, markerOptions);
    marker.bindPopup(buildPopup(feature), {
      minWidth: 250,
      maxWidth: 340,
      maxHeight: 420,
      autoPanPadding: [24, 24],
    });
    if (isApproximate) {
      marker.bindTooltip("Ubicación aproximada en Xalapa", {
        direction: "top",
        offset: [0, -17],
      });
    }
    state.markerById.set(feature.id, marker);
  }
}

function getSpreadMarkerPosition(layout) {
  const spreadRadiusPixels = 42;
  const zoom = map.getZoom();
  const basePoint = map.project(layout.basePosition, zoom);
  const offset = L.point(
    Math.cos(layout.angle) * spreadRadiusPixels,
    Math.sin(layout.angle) * spreadRadiusPixels,
  );
  return map.unproject(basePoint.add(offset), zoom);
}

function updateApproximateMarkerPositions() {
  for (const layout of state.approximateMarkerLayouts) {
    const marker = state.markerById.get(layout.featureId);
    if (marker) marker.setLatLng(getSpreadMarkerPosition(layout));
  }
}

function applyFilters({ fitMap }) {
  const query = normalizeText(elements.searchInput.value.trim());
  const materialId = elements.materialSelect.value;
  const selectedDay = elements.daySelect.value;
  const selectedService = elements.serviceSelect.value;
  const openNow = elements.openNowCheckbox.checked;

  let filtered = state.features.filter((feature) => {
    const properties = feature.properties;
    const materialNames = properties.materials
      .map((id) => state.materialsById.get(id)?.name || id)
      .join(" ");
    const searchableText = normalizeText([
      properties.name,
      properties.address,
      properties.serviceArea,
      properties.notes,
      materialNames,
    ].filter(Boolean).join(" "));

    if (query && !searchableText.includes(query)) return false;
    if (materialId && !properties.materials.includes(materialId)) return false;
    if (selectedDay && !hasScheduleOnDay(properties.schedule, selectedDay)) return false;
    if (selectedService && properties.services?.[selectedService] !== true) return false;
    if (openNow && !isOpenNow(properties.schedule)) return false;
    return true;
  });

  if (state.userLocation) {
    filtered = filtered
      .map((feature) => ({
        feature,
        distance: getDistanceToFeature(feature),
      }))
      .sort((first, second) => first.distance - second.distance)
      .map(({ feature }) => feature);
  }

  renderResults(filtered);
  renderMapMarkers(filtered, fitMap);
}

function renderResults(features) {
  elements.resultsList.replaceChildren();
  const count = features.length;
  elements.resultsSummary.textContent = `${count} ${count === 1 ? "centro encontrado" : "centros encontrados"}`;

  if (count === 0) {
    elements.resultsList.append(elements.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const feature of features) fragment.append(createResultCard(feature));
  elements.resultsList.append(fragment);
}

function createResultCard(feature) {
  const properties = feature.properties;
  const article = document.createElement("article");
  article.className = "result-card";
  article.dataset.featureId = feature.id;

  const heading = document.createElement("div");
  heading.className = "result-card__heading";

  const title = document.createElement("h3");
  title.textContent = properties.name;
  heading.append(title);

  if (state.userLocation) {
    const distance = document.createElement("span");
    distance.className = "distance";
    const prefix = properties.locationPrecision === "city" ? "≈ " : "";
    distance.textContent = `${prefix}${formatDistance(getDistanceToFeature(feature))}`;
    distance.title = properties.locationPrecision === "city"
      ? "Distancia aproximada a una ubicación representativa de Xalapa"
      : "Distancia en línea recta";
    heading.append(distance);
  }

  article.append(heading);

  const addressText = properties.address || properties.serviceArea || "Domicilio no disponible";
  article.append(createParagraph(addressText, "address"));

  if (properties.locationPrecision === "city") {
    const badge = document.createElement("span");
    badge.className = "approximate-badge";
    badge.textContent = "Ubicación aproximada";
    article.append(badge);
  }

  const materials = document.createElement("div");
  materials.className = "materials";
  for (const materialId of properties.materials) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = state.materialsById.get(materialId)?.name || materialId;
    materials.append(tag);
  }
  article.append(materials);

  const scheduleText = properties.schedule?.display || "Horario no disponible";
  article.append(createParagraph(`Horario: ${scheduleText}`, "schedule"));

  const activeServices = Object.entries(properties.services || {})
    .filter(([, enabled]) => enabled)
    .map(([service]) => SERVICE_LABELS[service] || service);
  if (activeServices.length) {
    article.append(createParagraph(`Modalidad: ${activeServices.join(", ")}`, "services"));
  }

  if (properties.notes) article.append(createParagraph(properties.notes, "notes"));

  const contacts = buildContactLinks(properties);
  if (contacts.childElementCount) article.append(contacts);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const mapButton = document.createElement("button");
  mapButton.className = "map-button";
  mapButton.type = "button";
  mapButton.textContent = "Ver en el mapa";
  mapButton.addEventListener("click", () => focusFeature(feature));
  actions.append(mapButton);
  article.append(actions);

  return article;
}

function buildContactLinks(properties) {
  const container = document.createElement("div");
  container.className = "contact-links";

  if (properties.phone) {
    appendLink(container, `tel:+52${properties.phone}`, formatPhone(properties.phone), "Llamar por teléfono");
  }
  if (properties.email) {
    appendLink(container, `mailto:${properties.email}`, "Correo electrónico");
  }
  if (properties.social?.whatsapp) {
    appendLink(container, properties.social.whatsapp, "WhatsApp", "Abrir WhatsApp", true);
  }
  if (properties.social?.instagram) {
    appendLink(container, properties.social.instagram, "Instagram", "Abrir Instagram", true);
  }
  if (properties.social?.facebook) {
    appendLink(container, properties.social.facebook, "Facebook", "Abrir Facebook", true);
  }
  if (properties.sourceMapUrl) {
    appendLink(container, properties.sourceMapUrl, "Google Maps", "Abrir ubicación en Google Maps", true);
  }

  return container;
}

function appendLink(container, href, text, ariaLabel = text, newTab = false) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  link.setAttribute("aria-label", ariaLabel);
  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  container.append(link);
}

function renderMapMarkers(features, fitMap) {
  markerLayer.clearLayers();
  for (const feature of features) {
    const marker = state.markerById.get(feature.id);
    if (marker) markerLayer.addLayer(marker);
  }

  if (!fitMap || features.length === 0) return;

  if (features.length === 1) {
    const [longitude, latitude] = features[0].geometry.coordinates;
    map.setView([latitude, longitude], 15);
    return;
  }

  const bounds = markerLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
}

function focusFeature(feature) {
  const [longitude, latitude] = feature.geometry.coordinates;
  map.setView([latitude, longitude], 16);
  state.markerById.get(feature.id)?.openPopup();

  if (window.matchMedia("(max-width: 800px)").matches) {
    elements.mapPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function buildPopup(feature) {
  const properties = feature.properties;
  const materials = properties.materials
    .map((id) => state.materialsById.get(id)?.name || id)
    .map(escapeHtml)
    .map((name) => `<li>${name}</li>`)
    .join("");
  const schedule = escapeHtml(properties.schedule?.display || "Horario no disponible");
  const address = escapeHtml(properties.address || properties.serviceArea || "Domicilio no disponible");
  const approximate = properties.locationPrecision === "city"
    ? '<p class="popup__notice">Ubicación aproximada en Xalapa</p>'
    : "";
  const activeServices = Object.entries(properties.services || {})
    .filter(([, enabled]) => enabled)
    .map(([service]) => SERVICE_LABELS[service] || service)
    .map(escapeHtml)
    .join(", ");
  const services = activeServices
    ? `<div class="popup__row"><dt>Modalidad</dt><dd>${activeServices}</dd></div>`
    : "";
  const notes = properties.notes
    ? `<div class="popup__notes"><strong>Notas</strong><p>${escapeHtml(properties.notes)}</p></div>`
    : "";
  const links = buildPopupLinks(properties);

  return `
    <div class="popup">
      <h3>${escapeHtml(properties.name)}</h3>
      ${approximate}
      <dl class="popup__details">
        <div class="popup__row">
          <dt>Dirección</dt>
          <dd>${address}</dd>
        </div>
        <div class="popup__row">
          <dt>Residuos que recibe</dt>
          <dd><ul class="popup__material-list">${materials}</ul></dd>
        </div>
        <div class="popup__row">
          <dt>Horario</dt>
          <dd>${schedule}</dd>
        </div>
        ${services}
      </dl>
      ${notes}
      ${links}
    </div>
  `;
}

function buildPopupLinks(properties) {
  const links = [];
  if (properties.phone) {
    links.push(`<a href="tel:+52${escapeHtml(properties.phone)}">${escapeHtml(formatPhone(properties.phone))}</a>`);
  }
  if (properties.email) {
    links.push(`<a href="mailto:${escapeHtml(properties.email)}">Correo</a>`);
  }
  if (properties.social?.whatsapp) links.push(externalPopupLink(properties.social.whatsapp, "WhatsApp"));
  if (properties.social?.instagram) links.push(externalPopupLink(properties.social.instagram, "Instagram"));
  if (properties.social?.facebook) links.push(externalPopupLink(properties.social.facebook, "Facebook"));
  if (properties.sourceMapUrl) links.push(externalPopupLink(properties.sourceMapUrl, "Google Maps"));
  return links.length
    ? `<div class="popup__links" aria-label="Contacto y enlaces">${links.join("")}</div>`
    : "";
}

function externalPopupLink(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function clearFilters() {
  elements.filtersForm.reset();
  elements.searchInput.focus();
  applyFilters({ fitMap: true });
}

function hasScheduleOnDay(schedule, day) {
  return Array.isArray(schedule?.weekly?.[day]) && schedule.weekly[day].length > 0;
}

function isOpenNow(schedule) {
  const now = new Date();
  const day = DAY_KEYS[now.getDay()];
  const intervals = schedule?.weekly?.[day] || [];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return intervals.some(([start, end]) => {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null) return false;
    if (endMinutes < startMinutes) return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  });
}

function timeToMinutes(time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function requestUserLocation() {
  if (!navigator.geolocation) {
    elements.locationStatus.textContent = "Tu navegador no permite obtener la ubicación.";
    return;
  }

  elements.locationButton.disabled = true;
  elements.locationButton.textContent = "Obteniendo ubicación…";
  elements.locationStatus.textContent = "Esperando permiso de ubicación…";

  navigator.geolocation.getCurrentPosition(
    handleLocationSuccess,
    handleLocationError,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
  );
}

function handleLocationSuccess(position) {
  state.userLocation = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };

  if (state.userMarker) map.removeLayer(state.userMarker);
  if (state.accuracyCircle) map.removeLayer(state.accuracyCircle);

  state.userMarker = L.circleMarker(
    [state.userLocation.latitude, state.userLocation.longitude],
    {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#1769c2",
      fillOpacity: 1,
    },
  ).addTo(map).bindPopup("Tu ubicación aproximada");

  state.accuracyCircle = L.circle(
    [state.userLocation.latitude, state.userLocation.longitude],
    {
      radius: position.coords.accuracy,
      color: "#1769c2",
      fillColor: "#1769c2",
      fillOpacity: 0.08,
      weight: 1,
    },
  ).addTo(map);

  elements.locationButton.disabled = false;
  elements.locationButton.textContent = "Actualizar mi ubicación";
  elements.locationStatus.textContent = "Resultados ordenados por distancia en línea recta.";
  applyFilters({ fitMap: false });
  map.setView([state.userLocation.latitude, state.userLocation.longitude], 13);
}

function handleLocationError(error) {
  const messages = {
    1: "No se concedió permiso para acceder a tu ubicación.",
    2: "No fue posible determinar tu ubicación.",
    3: "La solicitud de ubicación tardó demasiado.",
  };
  elements.locationStatus.textContent = messages[error.code] || "No fue posible obtener tu ubicación.";
  elements.locationButton.disabled = false;
  elements.locationButton.textContent = "Usar mi ubicación";
}

function getDistanceToFeature(feature) {
  const [longitude, latitude] = feature.geometry.coordinates;
  return haversineDistance(
    state.userLocation.latitude,
    state.userLocation.longitude,
    latitude,
    longitude,
  );
}

function haversineDistance(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadiusKm = 6371;
  const latitudeDelta = degreesToRadians(latitudeB - latitudeA);
  const longitudeDelta = degreesToRadians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(degreesToRadians(latitudeA))
    * Math.cos(degreesToRadians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function formatDistance(distanceKm) {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
}

function formatPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return phone;
}

function normalizeText(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX");
}

function createParagraph(text, className) {
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showLoadError(message) {
  elements.resultsSummary.textContent = "No fue posible cargar los resultados";
  elements.resultsList.setAttribute("aria-busy", "false");
  elements.resultsList.innerHTML = `
    <div class="error-state" role="alert">
      <h3>Error al cargar el sitio</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}
