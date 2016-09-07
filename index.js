/**
 * @preserve
 * GeoJSON -> SVG text renderer
 *
 * @license MIT
 * @copyright 2016 Alexander Milevski <info@w8r.name>
 */
var project     = require('geojson-project');
var extend      = require('json-extend');
var hash        = require('string-hash');
var getFontData = require('./src/get_font_data');
var Matrix      = require("transformation-matrix-js").Matrix;

module.exports               = renderer;
module.exports.Renderer      = Renderer;
module.exports.DefaultStyles = DefaultStyles;

var XMLNS   = 'http://www.w3.org/2000/svg';
var XLINK   = 'http://www.w3.org/1999/xlink';
var VERSION = 1.2;

var SYMBOL  = 'symbol';
var TEXTBOX = 'textbox';


var DefaultStyles = require('./src/default_styles');
var DefaultFonts  = [
  require('./fonts/arial_helvetica_ss'),
  require('./fonts/helvetica_arial_ss'),
  require('./fonts/georgia_times_s'),
  require('./fonts/lucida_monaco_mono'),
  require('./fonts/verdana_geneva_ss')
];

/**
 *
 * @class Renderer
 *
 * @param {GeoJSON=} gj
 * @param {Object=}  styles
 * @param {Array.<Number>=} extent
 * @param {Function=} projection
 * @param {String|Function=} type
 * @param {Object}           fonts
 */
function Renderer (gj, styles, extent, projection, type, fonts) {
  this._data       = null;
  this._extent     = null;
  this._styles     = DefaultStyles;
  this._projection = null;
  this._type       = null;
  this._fonts      = [];

  this._defs       = null;

  if (gj)         this.data(gj);
  if (styles)     this.styles(styles);
  if (extent)     this.extent(extent);
  if (projection) this.projection(project);
  if (type)       this.type(type);
  this.fonts(fonts || DefaultFonts);
}

function renderer (gj, styles, extent, project, type) {
  return new Renderer(gj, styles, extent, project, type);
}

Renderer.prototype = {

  /**
   * Stores styles for the renderer
   *
   * @param  {Object|Function} styles
   * @return {Renderer}
   */
  styles: function (styles) {
    this._styles = (typeof styles === 'function') ?
      styles : extend({}, DefaultStyles, styles);
    return this;
  },


  /**
   * @param  {Array.<Object>} fonts
   * @return {Renderer}
   */
  fonts: function(fonts) {
    if (!Array.isArray(fonts)) {
      fonts = [fonts];
    }

    for (var i = 0, len = fonts.length; i < len; i++) {
      fonts[i].values = fonts[i].values.sort(function(a, b) {
        return a.size - b.size;
      });
      this._fonts.push(fonts[i]);
    }

    return this;
  },


  /**
   * Property that is going to be used as for type->style selection
   * @param  {String|Function} type
   * @return {Renderer}
   */
  type: function(type) {
    this._type = type;
    return this;
  },


  /**
   * Here you can pass GeoJSON
   *
   * @param  {GeoJSON} data
   * @return {Renderer}
   */
  data: function (data) {
    if (data.type !== 'FeatureCollection') {
      data = { type: 'FeatureCollection', 'features': [data] };
    }

    this._data = data;
    return this;
  },


  /**
   * Projection function for the coordinates
   *
   * @param  {Function} proj
   * @return {Renderer}
   */
  projection: function (proj) {
    this._projection = proj;
    if (this._data) {
      this._data = project(this._data, proj);
    }
    return this;
  },


  /**
   * Custom extent to be used as a `viewBox`
   *
   * @param  {Array.<Number>} extent
   * @return {Renderer}
   */
  extent: function (extent) {
    this._extent = extent;
    return this;
  },


  /**
   * Main rendering routine
   * @param {GeoJSON=} data
   * @return {String}
   */
  render: function (data) {
    if (data) this.data(data);

    var rendered = [];
    var bbox = getDefaultBBox();
    this._defs = [];
    for (var i = 0, len = this._data.features.length; i < len; i++) {
      this._renderFeature(this._data.features[i], rendered, bbox);
    }

    this._renderContainer(rendered,
      this._extent || this._data.extent || this._data.bbox ||
      (this._data.properties ? this._data.properties.bbox : null) || bbox);
    return rendered.join('');
  },


  /**
   * Wraps generated content with the SVG container
   *
   * @param  {Array.<String>} accum
   * @param  {Array.<Number>} bbox
   */
  _renderContainer: function (accum, bbox) {
    var viewBox = [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]];
    if (this._defs.length !== 0) {
      accum.unshift('</defs>');
      accum.unshift.apply(accum, this._defs.slice());
      accum.unshift('<defs>');
    }
    accum.unshift(
      ['<svg viewBox="', viewBox.join(' '), '" xmlns="', XMLNS,
       '" xmlns:xlink="', XLINK, '" version="', VERSION, '">'].join(''), '<g>');

    accum.push('</g>', '</svg>');
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<String>} accum
   * @param  {Array.<Number>} bbox
   */
  _renderFeature: function (feature, accum, bbox) {
    var featureBounds = getDefaultBBox();

    switch (feature.geometry.type) {
      case 'Polygon':
      case 'MultiPolygon':
        this._renderPolygon(feature, accum, bbox, featureBounds);
        break;
      case 'LineString':
      case 'MultiLineString':
        this._renderLineString(feature, accum, bbox, featureBounds);
        break;
      //case 'MultiPoint': TODO
      case 'Point':
        this._renderPoint(feature, accum, bbox, featureBounds);
        break;
      default:
        break;
    }
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<String>} accum
   * @param  {Array.<Number>} bbox
   * @param  {Array.<Number>} featureBounds
   */
  _renderLineString: function (feature, accum, bbox, featureBounds) {
    var properties = feature.properties;
    var className = ('linestring ' + (properties.className || '')).trim();
    accum.push('<path class="', className,
      '" d="', this._getPath(feature, false, bbox, featureBounds), '"',
      this._getStyles(feature, bbox, featureBounds), ' />');
  },


  /**
   * @param  {Feature}        feature
   * @param  {Array.<String>} accum
   * @param  {Array.<Number}  bbox
   * @param  {Array.<Number>} featureBounds
   */
  _renderText: function (feature, accum, bbox, featureBounds) {
    var properties = extend({}, this._selectStyle(feature), feature.properties);
    var fontSize   = properties.fontSize;
    var fontColor  = properties.fontColor;
    var fontFamily = properties.fontFamily || '';

    var text = properties.text;
    var pos = [featureBounds[0], featureBounds[1]];

    var content = this._renderTextContent(text, fontSize, fontFamily, featureBounds);

    if (fontFamily) {
      fontFamily = 'font-family="' + fontFamily + '" ';
    }

    accum.push('<text ', fontFamily,
      'font-size="', fontSize, '" ',
      'fill="',      fontColor, '" ',
      'x="',         pos[0], '" ',
      'y="',         pos[1], '" ',
      '>',
        content,
      '</text>');
  },


  /**
   * @param  {String}         text
   * @param  {Number}         fontSize
   * @param  {String}         fontFamily
   * @param  {Array.<Number>} featureBounds
   * @return {String}
   */
  _renderTextContent: function(text, fontSize, fontFamily, featureBounds) {
    var fontData = getFontData(fontFamily, fontSize, this._fonts);
    console.log('font data ', fontData);
    return text;
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<String>} accum
   * @param  {Array.<Number>} bbox
   * @param  {Array.<Number>} featureBounds
   */
  _renderPolygon: function (feature, accum, bbox, featureBounds) {
    var properties = feature.properties;
    var className = ('polygon ' + (properties.className || '')).trim();
    accum.push('<path class="', className,
      '" d="', this._getPath(feature, true, bbox, featureBounds), '"',
      this._getStyles(feature, bbox, featureBounds), '/>');

    if (this._type && feature.properties[this._type] === TEXTBOX) {
      this._renderText(feature, accum, bbox, featureBounds);
    }
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<String>} accum
   * @param  {Array.<Number>} bbox
   * @param  {Array.<Number>} featureBounds
   */
  _renderPoint: function (feature, accum, bbox, featureBounds) {
    if (this._type && feature.properties[this._type] === SYMBOL) {
      this._renderSymbol(feature, accum, bbox, featureBounds);
    } else {
      var coord = feature.geometry.coordinates;
      var className = ('point ' + (feature.properties.className || '')).trim();

      extendBBox(bbox, coord);
      extendBBox(featureBounds, coord);

      accum.push('<circle class="', className,
        '" cx="', coord[0], '" cy="', coord[1],
        '" r="',  feature.properties.radius || 1,  '" ',
        this._getStyles(feature, bbox, featureBounds), ' />');
    }
  },


  /**
   * Create symbol for putting into defs
   *
   * @param  {Feature} feature
   * @return {String} symbol id
   */
  _getSymbolDef: function (feature) {
    var src = feature.properties.symbol.src.trim();
    var viewBox = src.match(/view[Bb]ox\=["']([^"']+)["']/m)[1]
      .split(' ').map(parseFloat);
    var id = 'feature-symbol-' + hash(src);

    // strip garbage
    src = src
      .replace(/<\/?svg[^>]*>/g, '')
      .replace(/\<\?xml.+\?\>|\<\!DOCTYPE.+]\>/g, '')
      .replace(/<metadata>[\s\S]*?<\/metadata>/g, '');

    var symbol = [
      '<symbol id="', id, '" viewBox="', viewBox.join(' '), '">',
        src,
      '</symbol>'
    ].join('');

    if (this._defs.indexOf(symbol) === -1) {
      this._defs.push(symbol);
    }

    return id;
  },


  /**
   * @param  {Feature}        feature
   * @param  {Array.<Number>} bbox
   * @param  {Array.<Number>} featureBounds
   * @return {String}
   */
  _createSymbol: function (feature, bbox, featureBounds) {
    var symbol    = feature.properties.symbol;
    var symbolDef = this._getSymbolDef(feature);
    var width     = symbol.width  || '';
    var height    = symbol.height || '';
    var coords    = feature.geometry.coordinates;

    var symbolBBox = [
      coords[0] - width / 2, coords[1] - height / 2,
      coords[0] + width / 2, coords[1] + height / 2
    ];

    var transform = this._getSymbolTransform(feature, bbox, featureBounds);
    symbolBBox = Matrix.from.apply(Matrix, transform).applyToArray(symbolBBox);

    extendBBox(featureBounds, symbolBBox.slice(0, 2));
    extendBBox(featureBounds, symbolBBox.slice(2, 4));

    extendBBox(bbox,          symbolBBox.slice(0, 2));
    extendBBox(bbox,          symbolBBox.slice(2, 4));

    var use = [
      '<use xlink:href="#', symbolDef, '" transform="matrix(',
        transform.join(' '),   ')" ',
        'width="',  width,     '" ',
        'height="', height,    '" ',
        'x="',      coords[0] ,'" ',
        'y="',      coords[1] ,'" ',
        this._getStyles(feature, bbox, featureBounds),
      '/>'
    ].join('');
    return use;
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<Number>} bbox
   * @param  {Array.<Number>} featureBounds
   * @return {Array.<Number>} matrix
   */
  _getSymbolTransform: function (feature, bbox, featureBounds) {
    var props    = feature.properties;
    var symbol   = props.symbol;
    var center   = feature.geometry.coordinates;
    var scale    = props.scale    || 1;
    var rotation = props.rotation || 0;

    var m = Matrix.from(1, 0, 0, 1, 0, 0)
      .translate(center[0], center[1])
      .rotate(rotation)
      .scale(scale, scale)
      .translate(-center[0], -center[1]);

    return m.toArray();
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<String>} accum
   * @param  {Array.<Number>} bbox
   * @param  {Array.<Number>} featureBounds
   */
  _renderSymbol: function (feature, accum, bbox, featureBounds) {
    var coord = feature.geometry.coordinates;
    var className = ('point ' + (feature.properties.className || '')).trim();
    var radius = feature.properties.radius || 1;
    var symbol;

    if (feature.properties.symbol.src) {
      accum.push(this._createSymbol(feature, bbox, featureBounds));
    } else {
      extendBBox(bbox, coord);
      extendBBox(featureBounds, coord);

      accum.push('<circle class="', className,
        '" cx="', coord[0], '" cy="', coord[1],
        '" r="',  radius, '" ',
        this._getStyles(feature, bbox, featureBounds), '/>');
    }
  },


  /**
   * @param  {Array.<Array.<Number>>} coords
   * @param  {Booelean}               closed
   * @param  {Array.<Number>}         bbox
   * @param  {Array.<Number>}         featureBounds
   * @return {String}
   */
  _coordinatesToPath: function (coords, closed, bbox, fBounds) {
    var res = '', i, len, c, x, y;
    if (!isFinite(coords[0][0])) {
      for (i = 0, len = coords.length; i < len; i++) {
        res += ' ' + this._coordinatesToPath(coords[i], closed, bbox, fBounds);
      }
    } else {
      for (i = 0, len = coords.length; i < len; i++) {
        c = coords[i];
        x = c[0];
        y = c[1];
        res += (i === 0 ? 'M' : 'L') + x + ' ' + y;

        extendBBox(bbox, c);
        extendBBox(fBounds, c);
      }

      if (closed) res += 'Z';
    }

    return res || 'M0 0';
  },


  /**
   * @param {Feature} feature
   * @param {Boolean} closed
   * @param {Array.<Number>}  bbox
   * @param {Array.<Number>}  fBounds
   */
  _getPath: function (feature, closed, bbox, fBounds) {
    return this
      ._coordinatesToPath(feature.geometry.coordinates, closed, bbox, fBounds)
      .trim();
  },


  /**
   * @param  {Feature} feature
   * @return {Object}  style
   */
  _selectStyle: function (feature) {
    if (this._type) {
      if (typeof this._type === 'function') {
        return this._type(feature, this._styles);
      } else {
        return this._styles[feature.properties[this._type]];
      }
    } else {
      return this._styles[feature.geometry.type];
    }
  },


  /**
   * @param  {Feature} feature
   * @param  {Array.<Number>}  bbox
   * @param  {Array.<Number>}  featureBounds
   * @return {String} styles
   */
  _getStyles: function(feature, bbox, featureBounds) {
    var styles = {
      'stroke-width': 1
    };
    var currentStyle = {};
    var styleString = '';

    if (typeof this._styles === 'function') {
      styles = this._styles(feature);
    } else {
      styles = extend({}, feature.properties, this._selectStyle(feature));
    }

    if (styles.stroke || styles.weight) {
      currentStyle['stroke']          = styles.color;
      currentStyle['stroke-opacity']  = styles.opacity;
      currentStyle['stroke-width']    = styles.weight;
      currentStyle['stroke-linecap']  = styles.lineCap  || 'round';
      currentStyle['stroke-linejoin'] = styles.lineJoin || 'round';

      if (styles.dashArray) {
        currentStyle['stroke-dasharray'] = styles.dashArray;
      }

      if (styles.dashOffset) {
        currentStyle['stroke-dashoffset'] = styles.dashOffset;
      }

      if (styles.weight) {
        padBBox(featureBounds, styles.weight);

        extendBBox(bbox, featureBounds.slice(0, 2));
        extendBBox(bbox, featureBounds.slice(2, 4));
      }
    } else {
      currentStyle['stroke'] = 'none';
    }

    if (styles.fill) {
      currentStyle['fill']         = styles.fillColor   || styles.color;
      currentStyle['fill-opacity'] = styles.fillOpacity || styles.opacity || 0;
      currentStyle['fill-rule']    = styles.fillRule    || 'evenodd';
    } else {
      currentStyle['fill'] = 'none';
    }

    for (var rule in currentStyle) {
      if (currentStyle[rule] !== undefined) {
        styleString += ' ' + rule + '="' + currentStyle[rule] + '"';
      }
    }
    return styleString;
  }
};


/**
 * BBox 'extend' in-place
 *
 * @param  {Array.<Number>} bbox
 * @param  {Array.<Number>} coord
 */
function extendBBox (bbox, coord) {
  var x = coord[0];
  var y = coord[1];
  bbox[0] = Math.min(x, bbox[0]);
  bbox[1] = Math.min(y, bbox[1]);
  bbox[2] = Math.max(x, bbox[2]);
  bbox[3] = Math.max(y, bbox[3]);
}


/**
 * BBox 'extend' in-place
 *
 * @param  {Array.<Number>} bbox
 * @param  {Number}         padding
 */
function padBBox (bbox, padding) {
  bbox[0] -= padding;
  bbox[1] -= padding;
  bbox[2] += padding;
  bbox[3] += padding;
}


/**
 * @return {Array.<Number>}
 */
function getDefaultBBox () {
  return [Infinity, Infinity, -Infinity, -Infinity];
}
