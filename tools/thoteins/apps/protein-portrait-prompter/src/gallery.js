// Card Gallery Module
// Loads features.csv and persona.csv, renders protein cards with mapped properties

const CSV_PATHS = {
  features: '../../data/proteins/features.csv',
  persona: '../../data/proteins/persona.csv',
  mapping: '../../data/mapping.json'
};

const IMAGE_BASE_PATH = '../../data/proteins/images';

/**
 * Parse CSV text into array of objects
 * Handles quoted fields that contain commas
 */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse headers
  const headers = parseCSVLine(lines[0]);
  const rows = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line, handling quoted fields with commas
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote (two consecutive quotes)
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add last field
  result.push(current.trim());

  return result;
}

/**
 * Load and parse both CSV files
 */
export async function loadProteinData() {
  try {
    const [featuresResp, personaResp, mappingResp] = await Promise.all([
      fetch(CSV_PATHS.features),
      fetch(CSV_PATHS.persona),
      fetch(CSV_PATHS.mapping)
    ]);

    if (!featuresResp.ok || !personaResp.ok) {
      throw new Error('Failed to load CSV files');
    }

    const featuresText = await featuresResp.text();
    const personaText = await personaResp.text();
    const mappingJson = mappingResp.ok ? await mappingResp.json() : null;

    const features = parseCSV(featuresText);
    const persona = parseCSV(personaText);

    // Merge features and persona by uniprot_id
    const merged = features.map(feat => {
      const pers = persona.find(p => p.uniprot_id === feat.uniprot_id) || {};
      return { ...feat, ...pers, _features: feat, _persona: pers };
    });

    return { proteins: merged, mapping: mappingJson, featuresKeys: Object.keys(features[0] || {}), personaKeys: Object.keys(persona[0] || {}) };
  } catch (error) {
    console.error('Error loading protein data:', error);
    return { proteins: [], mapping: null, featuresKeys: [], personaKeys: [] };
  }
}

/**
 * Get property categories from mapping.json
 */
function categorizeProperties(mapping, featuresKeys, personaKeys) {
  if (!mapping) {
    return {
      molecular: featuresKeys.filter(k => !['uniprot_id', 'gene_symbol', 'short_name'].includes(k)),
      persona: personaKeys.filter(k => !['uniprot_id', 'gene_symbol', 'short_name'].includes(k)),
      mappings: {}
    };
  }

  // Get molecular fields from mapping.json
  const molecularFields = (mapping.molecular || []).map(m => m.name);

  // Get human (persona) fields from mapping.json
  const personaFields = (mapping.human || []).map(h => h.name);

  // Build mapping relationships
  const mappings = {};
  (mapping.mappings || []).forEach(m => {
    if (m.source && m.target) {
      mappings[m.source] = { target: m.target, type: m.type };
      if (!mappings._reverse) mappings._reverse = {};
      mappings._reverse[m.target] = { source: m.source, type: m.type };
    }
  });

  return {
    molecular: molecularFields,
    persona: personaFields,
    mappings
  };
}

/**
 * Create a pretty label from a field name
 */
function prettifyLabel(fieldName) {
  // Handle special cases
  const labelMap = {
    'mass': 'Mass (kDa)',
    'length': 'Length (aa)',
    'percent_disordered': 'Disorder (%)',
    'rvis_percentile': 'RVIS %ile',
    'domain_count': 'Domains',
    'transmembrane_count': 'TM Helices',
    'first_letter': 'First Letter',
    'gene_symbol': 'Gene',
    'uniprot_id': 'UniProt ID',
    'short_name': 'Short Name',
    'full_name': 'Full Name',
    'background_setting': 'Setting',
    'height': 'Height (cm)',
    'Sex': 'Gender',
    'Politics': 'Politics',
    'Skintone Hue ': 'Skin Hue',
    'Skintone Saturation': 'Skin Sat',
    'Skintone Lightness': 'Skin Light',
    'hexcode': 'Color'
  };

  return labelMap[fieldName] || fieldName;
}

/**
 * Create a protein card element
 */
function createProteinCard(protein, categories) {
  const card = document.createElement('div');
  card.className = 'protein-card';

  // Image section
  const imageDiv = document.createElement('div');
  imageDiv.className = 'protein-card-image';

  const imagePath = `${IMAGE_BASE_PATH}/${protein.uniprot_id}.png`;
  const hexcode = protein.hexcode || '#cccccc';

  // Try to load image, fall back to hex color
  const img = document.createElement('img');
  img.src = imagePath;
  img.alt = protein.gene_symbol;
  img.onerror = () => {
    // Replace with colored placeholder
    imageDiv.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'protein-card-image-placeholder';
    placeholder.style.backgroundColor = hexcode;
    placeholder.textContent = protein.gene_symbol || protein.uniprot_id;
    imageDiv.appendChild(placeholder);
  };
  imageDiv.appendChild(img);

  // Card body
  const body = document.createElement('div');
  body.className = 'protein-card-body';

  // Title
  const title = document.createElement('h3');
  title.className = 'protein-card-title';
  title.textContent = `${protein.gene_symbol || 'Unknown'} (${protein.short_name || protein.gene_symbol})`;

  // UniProt ID
  const id = document.createElement('p');
  id.className = 'protein-card-id';
  id.textContent = protein.uniprot_id;

  // Properties grid
  const propsDiv = document.createElement('div');
  propsDiv.className = 'protein-card-props';

  // Molecular column
  const molecularCol = document.createElement('div');
  molecularCol.className = 'protein-card-props-col';
  const molecularTitle = document.createElement('div');
  molecularTitle.className = 'protein-card-props-col-title';
  molecularTitle.textContent = 'Molecular';
  molecularCol.appendChild(molecularTitle);

  categories.molecular.forEach(propKey => {
    const value = protein[propKey];
    if (value && value !== '') {
      const propDiv = document.createElement('div');
      const mappedTo = categories.mappings[propKey];

      if (mappedTo) {
        propDiv.className = 'protein-card-prop-mapped';
        propDiv.title = `Mapped to: ${prettifyLabel(mappedTo.target)} via ${mappedTo.type}`;
      } else {
        propDiv.className = 'protein-card-prop';
      }

      const label = document.createElement('span');
      label.className = 'protein-card-prop-label';
      label.textContent = prettifyLabel(propKey);

      const valueSpan = document.createElement('span');
      valueSpan.className = 'protein-card-prop-value';
      // Format numeric values
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && value === numValue.toString()) {
        valueSpan.textContent = numValue % 1 === 0 ? numValue.toString() : numValue.toFixed(1);
      } else {
        valueSpan.textContent = value;
      }

      propDiv.appendChild(label);
      propDiv.appendChild(valueSpan);
      molecularCol.appendChild(propDiv);
    }
  });

  // Persona column
  const personaCol = document.createElement('div');
  personaCol.className = 'protein-card-props-col';
  const personaTitle = document.createElement('div');
  personaTitle.className = 'protein-card-props-col-title';
  personaTitle.textContent = 'Persona';
  personaCol.appendChild(personaTitle);

  categories.persona.forEach(propKey => {
    const value = protein[propKey];
    if (value && value !== '') {
      const propDiv = document.createElement('div');
      const mappedFrom = categories.mappings._reverse && categories.mappings._reverse[propKey];

      if (mappedFrom) {
        propDiv.className = 'protein-card-prop-mapped';
        propDiv.title = `Mapped from: ${prettifyLabel(mappedFrom.source)} via ${mappedFrom.type}`;
      } else {
        propDiv.className = 'protein-card-prop';
      }

      const label = document.createElement('span');
      label.className = 'protein-card-prop-label';
      label.textContent = prettifyLabel(propKey);

      const valueSpan = document.createElement('span');
      valueSpan.className = 'protein-card-prop-value';
      // Format numeric values
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && value === numValue.toString()) {
        valueSpan.textContent = numValue % 1 === 0 ? numValue.toString() : numValue.toFixed(1);
      } else {
        valueSpan.textContent = value;
      }

      propDiv.appendChild(label);
      propDiv.appendChild(valueSpan);
      personaCol.appendChild(propDiv);
    }
  });

  propsDiv.appendChild(molecularCol);
  propsDiv.appendChild(personaCol);

  body.appendChild(title);
  body.appendChild(id);
  body.appendChild(propsDiv);

  card.appendChild(imageDiv);
  card.appendChild(body);

  return card;
}

/**
 * Render the card gallery
 */
export function renderGallery(proteins, mapping, featuresKeys, personaKeys) {
  const galleryGrid = document.getElementById('gallery-grid');
  if (!galleryGrid) {
    console.error('Gallery grid element not found');
    return;
  }

  galleryGrid.innerHTML = '';

  if (!proteins || proteins.length === 0) {
    galleryGrid.innerHTML = '<p class="muted">No proteins to display. Check that CSV files are loaded.</p>';
    return;
  }

  const categories = categorizeProperties(mapping, featuresKeys, personaKeys);

  proteins.forEach(protein => {
    const card = createProteinCard(protein, categories);
    galleryGrid.appendChild(card);
  });
}

/**
 * Initialize the card gallery
 */
export async function initGallery() {
  const { proteins, mapping, featuresKeys, personaKeys } = await loadProteinData();
  renderGallery(proteins, mapping, featuresKeys, personaKeys);
}