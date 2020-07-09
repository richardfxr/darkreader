import {parse, RGBA, rgbToHSL, hslToString} from '../../utils/color';
import {clamp} from '../../utils/math';
import {getMatches} from '../../utils/text';
import {modifyBackgroundColor, modifyBorderColor, modifyForegroundColor, modifyGradientColor, modifyShadowColor, clearColorModificationCache} from '../../generators/modify-colors';
import {cssURLRegex, getCSSURLValue, getCSSBaseBath} from './css-rules';
import {getImageDetails, getFilteredImageDataURL, ImageDetails, cleanImageProcessingCache} from './image';
import {getAbsoluteURL} from './url';
import {logWarn, logInfo} from '../utils/log';
import {FilterConfig, Theme} from '../../definitions';

type CSSValueModifier = (filter: FilterConfig) => string | Promise<string>;

export interface ModifiableCSSDeclaration {
    property: string;
    value: string | CSSValueModifier;
    important: boolean;
    sourceValue: string;
}

export interface ModifiableCSSRule {
    selector: string;
    parentRule: any;
    declarations: ModifiableCSSDeclaration[];
}

export function getModifiableCSSDeclaration(property: string, value: string, rule: CSSStyleRule, ignoreImageSelectors: string[], isCancelled: () => boolean): ModifiableCSSDeclaration {
    const important = Boolean(rule && rule.style && rule.style.getPropertyPriority(property));
    const sourceValue = value;
    if (property.startsWith('--')) {
        return null;
    } else if (
        (property.indexOf('color') >= 0 && property !== '-webkit-print-color-adjust') ||
        property === 'fill' ||
        property === 'stroke'
    ) {
        const modifier = getColorModifier(property, value);
        if (modifier) {
            return {property, value: modifier, important, sourceValue};
        }
    } else if (property === 'background-image' || property === 'list-style-image') {
        const modifier = getBgImageModifier(value, rule, ignoreImageSelectors, isCancelled);
        if (modifier) {
            return {property, value: modifier, important, sourceValue};
        }
    } else if (property.indexOf('shadow') >= 0) {
        const modifier = getShadowModifier(property, value);
        if (modifier) {
            return {property, value: modifier, important, sourceValue};
        }
    }
    return null;
}

export function getModifiedUserAgentStyle(filter: FilterConfig, isIFrame: boolean) {
    const lines: string[] = [];
    if (!isIFrame) {
        lines.push('html {');
        lines.push(`    background-color: ${modifyBackgroundColor({r: 255, g: 255, b: 255}, filter)} !important;`);
        lines.push('}');
    }
    lines.push(`${isIFrame ? '' : 'html, body, '}input, textarea, select, button {`);
    lines.push(`    background-color: ${modifyBackgroundColor({r: 255, g: 255, b: 255}, filter)};`);
    lines.push('}');
    lines.push('html, body, input, textarea, select, button {');
    lines.push(`    border-color: ${modifyBorderColor({r: 76, g: 76, b: 76}, filter)};`);
    lines.push(`    color: ${modifyForegroundColor({r: 0, g: 0, b: 0}, filter)};`);
    lines.push('}');
    lines.push('a {');
    lines.push(`    color: ${modifyForegroundColor({r: 0, g: 64, b: 255}, filter)};`);
    lines.push('}');
    lines.push('table {');
    lines.push(`    border-color: ${modifyBorderColor({r: 128, g: 128, b: 128}, filter)};`);
    lines.push('}');
    lines.push('::placeholder {');
    lines.push(`    color: ${modifyForegroundColor({r: 169, g: 169, b: 169}, filter)};`);
    lines.push('}');
    lines.push('input:-webkit-autofill,');
    lines.push('textarea:-webkit-autofill,');
    lines.push('select:-webkit-autofill {');
    lines.push(`    background-color: ${modifyBackgroundColor({r: 250, g: 255, b: 189}, filter)} !important;`);
    lines.push(`    color: ${modifyForegroundColor({r: 0, g: 0, b: 0}, filter)} !important;`);
    lines.push('}');
    if (filter.scrollbarColor) {
        lines.push(getModifiedScrollbarStyle(filter));
    }
    if (filter.selectionColor) {
        lines.push(getModifiedSelectionStyle(filter));
    }
    return lines.join('\n');
}

function getModifiedSelectionStyle(theme: Theme) {
    const lines: string[] = [];
    let backgroundColorSelection: string;
    let foregroundColorSelection: string;
    if (theme.selectionColor === 'auto') {
        backgroundColorSelection = modifyBackgroundColor({r: 0, g: 96, b: 212}, theme);
        foregroundColorSelection = modifyForegroundColor({r: 255, g: 255, b: 255}, theme);
    } else {
        const rgb = parse(theme.selectionColor);
        const hsl = rgbToHSL(rgb);
        backgroundColorSelection = theme.selectionColor;
        if (hsl.l < 0.5) {
            foregroundColorSelection = '#FFF';
        } else {
            foregroundColorSelection = '#000';
        }
    }
    ['::selection', '::-moz-selection'].forEach((selection) => {
        lines.push(`${selection} {`);
        lines.push(`    background-color: ${backgroundColorSelection} !important;`);
        lines.push(`    color: ${foregroundColorSelection} !important;`);
        lines.push('}');
    });
    return lines.join('\n');
}

function getModifiedScrollbarStyle(theme: Theme) {
    const lines: string[] = [];
    let colorTrack: string;
    let colorIcons: string;
    let colorThumb: string;
    let colorThumbHover: string;
    let colorThumbActive: string;
    let colorCorner: string;
    if (theme.scrollbarColor === 'auto') {
        colorTrack = modifyBackgroundColor({r: 241, g: 241, b: 241}, theme);
        colorIcons = modifyForegroundColor({r: 96, g: 96, b: 96}, theme);
        colorThumb = modifyBackgroundColor({r: 176, g: 176, b: 176}, theme);
        colorThumbHover = modifyBackgroundColor({r: 144, g: 144, b: 144}, theme);
        colorThumbActive = modifyBackgroundColor({r: 96, g: 96, b: 96}, theme);
        colorCorner = modifyBackgroundColor({r: 255, g: 255, b: 255}, theme);
    } else {
        const rgb = parse(theme.scrollbarColor);
        const hsl = rgbToHSL(rgb);
        const isLight = hsl.l > 0.5;
        const lighten = (lighter: number) => ({...hsl, l: clamp(hsl.l + lighter, 0, 1)});
        const darken = (darker: number) => ({...hsl, l: clamp(hsl.l - darker, 0, 1)});
        colorTrack = hslToString(darken(0.4));
        colorIcons = hslToString(isLight ? darken(0.4) : lighten(0.4));
        colorThumb = hslToString(hsl);
        colorThumbHover = hslToString(lighten(0.1));
        colorThumbActive = hslToString(lighten(0.2));
    }
    lines.push('::-webkit-scrollbar {');
    lines.push(`    background-color: ${colorTrack};`);
    lines.push(`    color: ${colorIcons};`);
    lines.push('}');
    lines.push('::-webkit-scrollbar-thumb {');
    lines.push(`    background-color: ${colorThumb};`);
    lines.push('}');
    lines.push('::-webkit-scrollbar-thumb:hover {');
    lines.push(`    background-color: ${colorThumbHover};`);
    lines.push('}');
    lines.push('::-webkit-scrollbar-thumb:active {');
    lines.push(`    background-color: ${colorThumbActive};`);
    lines.push('}');
    lines.push('::-webkit-scrollbar-corner {');
    lines.push(`    background-color: ${colorCorner};`);
    lines.push('}');
    lines.push('* {');
    lines.push(`    scrollbar-color: ${colorTrack} ${colorThumb};`);
    lines.push('}');
    return lines.join('\n');
}

export function getModifiedFallbackStyle(filter: FilterConfig, {strict}) {
    const lines: string[] = [];
    lines.push(`html, body, ${strict ? 'body :not(iframe)' : 'body > :not(iframe)'} {`);
    lines.push(`    background-color: ${modifyBackgroundColor({r: 255, g: 255, b: 255}, filter)} !important;`);
    lines.push(`    border-color: ${modifyBorderColor({r: 64, g: 64, b: 64}, filter)} !important;`);
    lines.push(`    color: ${modifyForegroundColor({r: 0, g: 0, b: 0}, filter)} !important;`);
    lines.push('}');
    return lines.join('\n');
}

const unparsableColors = new Set([
    'inherit',
    'transparent',
    'initial',
    'currentcolor',
    'none',
    'unset',
]);

const colorParseCache = new Map<string, RGBA>();

export function parseColorWithCache($color: string) {
    $color = $color.trim();
    if (colorParseCache.has($color)) {
        return colorParseCache.get($color);
    }
    const color = parse($color);
    colorParseCache.set($color, color);
    return color;
}

function tryParseColor($color: string) {
    try {
        return parseColorWithCache($color);
    } catch (err) {
        return null;
    }
}

function getColorModifier(prop: string, value: string): string | CSSValueModifier {
    if (unparsableColors.has(value.toLowerCase())) {
        return value;
    }
    try {
        const rgb = parseColorWithCache(value);
        if (prop.indexOf('background') >= 0) {
            return (filter) => modifyBackgroundColor(rgb, filter);
        }
        if (prop.indexOf('border') >= 0 || prop.indexOf('outline') >= 0) {
            return (filter) => modifyBorderColor(rgb, filter);
        }
        return (filter) => modifyForegroundColor(rgb, filter);

    } catch (err) {
        logWarn('Color parse error', err);
        return null;
    }
}

const gradientRegex = /[\-a-z]+gradient\(([^\(\)]*(\(([^\(\)]*(\(.*?\)))*[^\(\)]*\))){0,15}[^\(\)]*\)/g;
const imageDetailsCache = new Map<string, ImageDetails>();
const awaitingForImageLoading = new Map<string, ((imageDetails: ImageDetails) => void)[]>();

function shouldIgnoreImage(element: CSSStyleRule, selectors: string[]) {
    for (let i = 0; i < selectors.length; i++) {
        const ingnoredSelector = selectors[i];
        if (element.matches(ingnoredSelector)) {
            return true;
        }
    }
    return false;
}

function getBgImageModifier(value: string, rule: CSSStyleRule, ignoreImageSelectors: string[], isCancelled: () => boolean): string | CSSValueModifier {
    try {
        const gradients = getMatches(gradientRegex, value);
        const urls = getMatches(cssURLRegex, value);

        if (urls.length === 0 && gradients.length === 0) {
            return value;
        }

        const getIndices = (matches: string[]) => {
            let index = 0;
            return matches.map((match) => {
                const valueIndex = value.indexOf(match, index);
                index = valueIndex + match.length;
                return {match, index: valueIndex};
            });
        };
        const matches = getIndices(urls).map((i) => ({type: 'url', ...i}))
            .concat(getIndices(gradients).map((i) => ({type: 'gradient', ...i})))
            .sort((a, b) => a.index - b.index);

        const getGradientModifier = (gradient: string) => {
            const match = gradient.match(/^(.*-gradient)\((.*)\)$/);
            const type = match[1];
            const content = match[2];

            const partsRegex = /([^\(\),]+(\([^\(\)]*(\([^\(\)]*\)*[^\(\)]*)?\))?[^\(\),]*),?/g;
            const colorStopRegex = /^(from|color-stop|to)\(([^\(\)]*?,\s*)?(.*?)\)$/;

            const parts = getMatches(partsRegex, content, 1).map((part) => {
                part = part.trim();

                let rgb = tryParseColor(part);
                if (rgb) {
                    return (filter: FilterConfig) => modifyGradientColor(rgb, filter);
                }

                const space = part.lastIndexOf(' ');
                rgb = tryParseColor(part.substring(0, space));
                if (rgb) {
                    return (filter: FilterConfig) => `${modifyGradientColor(rgb, filter)} ${part.substring(space + 1)}`;
                }

                const colorStopMatch = part.match(colorStopRegex);
                if (colorStopMatch) {
                    rgb = tryParseColor(colorStopMatch[3]);
                    if (rgb) {
                        return (filter: FilterConfig) => `${colorStopMatch[1]}(${colorStopMatch[2] ? `${colorStopMatch[2]}, ` : ''}${modifyGradientColor(rgb, filter)})`;
                    }
                }

                return () => part;
            });

            return (filter: FilterConfig) => {
                return `${type}(${parts.map((modify) => modify(filter)).join(', ')})`;
            };
        };

        const getURLModifier = (urlValue: string) => {
            let url = getCSSURLValue(urlValue);
            if (rule.parentStyleSheet.href) {
                const basePath = getCSSBaseBath(rule.parentStyleSheet.href);
                url = getAbsoluteURL(basePath, url);
            } else if (rule.parentStyleSheet.ownerNode && rule.parentStyleSheet.ownerNode.baseURI) {
                url = getAbsoluteURL(rule.parentStyleSheet.ownerNode.baseURI, url);
            } else {
                url = getAbsoluteURL(location.origin, url);
            }

            const absoluteValue = `url("${url}")`;

            return async (filter: FilterConfig) => {
                let imageDetails: ImageDetails;
                if (imageDetailsCache.has(url)) {
                    imageDetails = imageDetailsCache.get(url);
                } else {
                    try {
                        if (shouldIgnoreImage(rule, ignoreImageSelectors))
                        if (awaitingForImageLoading.has(url)) {
                            const awaiters = awaitingForImageLoading.get(url);
                            imageDetails = await new Promise<ImageDetails>((resolve) => awaiters.push(resolve));
                            if (!imageDetails) {
                                return null;
                            }
                        } else {
                            awaitingForImageLoading.set(url, []);
                            imageDetails = await getImageDetails(url);
                            imageDetailsCache.set(url, imageDetails);
                            awaitingForImageLoading.get(url).forEach((resolve) => resolve(imageDetails));
                            awaitingForImageLoading.delete(url);
                        }
                        if (isCancelled()) {
                            return null;
                        }
                    } catch (err) {
                        logWarn(err);
                        if (awaitingForImageLoading.has(url)) {
                            awaitingForImageLoading.get(url).forEach((resolve) => resolve(null));
                            awaitingForImageLoading.delete(url);
                        }
                        return absoluteValue;
                    }
                }
                const bgImageValue = getBgImageValue(imageDetails, filter) || absoluteValue;
                return bgImageValue;
            };
        };

        const getBgImageValue = (imageDetails: ImageDetails, filter: FilterConfig) => {
            const {isDark, isLight, isTransparent, isLarge, width} = imageDetails;
            let result: string;
            if (isDark && isTransparent && filter.mode === 1 && !isLarge && width > 2) {
                logInfo(`Inverting dark image ${imageDetails.src}`);
                const inverted = getFilteredImageDataURL(imageDetails, {...filter, sepia: clamp(filter.sepia + 10, 0, 100)});
                result = `url("${inverted}")`;
            } else if (isLight && !isTransparent && filter.mode === 1) {
                if (isLarge) {
                    result = 'none';
                } else {
                    logInfo(`Dimming light image ${imageDetails.src}`);
                    const dimmed = getFilteredImageDataURL(imageDetails, filter);
                    result = `url("${dimmed}")`;
                }
            } else if (filter.mode === 0 && isLight && !isLarge) {
                logInfo(`Applying filter to image ${imageDetails.src}`);
                const filtered = getFilteredImageDataURL(imageDetails, {...filter, brightness: clamp(filter.brightness - 10, 5, 200), sepia: clamp(filter.sepia + 10, 0, 100)});
                result = `url("${filtered}")`;
            } else {
                result = null;
            }
            return result;
        };

        const modifiers: CSSValueModifier[] = [];

        let index = 0;
        matches.forEach(({match, type, index: matchStart}, i) => {
            const prefixStart = index;
            const matchEnd = matchStart + match.length;
            index = matchEnd;
            modifiers.push(() => value.substring(prefixStart, matchStart));
            modifiers.push(type === 'url' ? getURLModifier(match) : getGradientModifier(match));
            if (i === matches.length - 1) {
                modifiers.push(() => value.substring(matchEnd));
            }
        });

        return (filter: FilterConfig) => {
            const results = modifiers.map((modify) => modify(filter));
            if (results.some((r) => r instanceof Promise)) {
                return Promise.all(results)
                    .then((asyncResults) => {
                        return asyncResults.join('');
                    });
            }
            return results.join('');
        };

    } catch (err) {
        logWarn(`Unable to parse gradient ${value}`, err);
        return null;
    }
}

function getShadowModifier(prop: string, value: string): CSSValueModifier {
    try {
        let index = 0;
        const colorMatches = getMatches(/(^|\s)([a-z]+\(.+?\)|#[0-9a-f]+|[a-z]+)(.*?(inset|outset)?($|,))/ig, value, 2);
        const modifiers = colorMatches.map((match, i) => {
            const prefixIndex = index;
            const matchIndex = value.indexOf(match, index);
            const matchEnd = matchIndex + match.length;
            index = matchEnd;
            const rgb = tryParseColor(match);
            if (!rgb) {
                return () => value.substring(prefixIndex, matchEnd);
            }
            return (filter: FilterConfig) => `${value.substring(prefixIndex, matchIndex)}${modifyShadowColor(rgb, filter)}${i === colorMatches.length - 1 ? value.substring(matchEnd) : ''}`;
        });

        return (filter: FilterConfig) => modifiers.map((modify) => modify(filter)).join('');

    } catch (err) {
        logWarn(`Unable to parse shadow ${value}`, err);
        return null;
    }
}

export function cleanModificationCache() {
    colorParseCache.clear();
    clearColorModificationCache();
    imageDetailsCache.clear();
    cleanImageProcessingCache();
    awaitingForImageLoading.clear();
}
