// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import readme from '../README.md?raw';
import pkg from '../package.json';

/*
 * Static checks on the shipped markup. They catch the accessibility regressions that are easy
 * to introduce while editing HTML by hand and invisible in a quick visual check: dangling ARIA
 * references, duplicate ids, unlabelled controls and buttons that submit by accident.
 */

const doc = new DOMParser().parseFromString(html, 'text/html');

const REPOSITORY = 'https://github.com/arslanagayev/nebula-auth';
const LIVE_DEMO = 'https://arslanagayev.github.io/nebula-auth/';
/** `{{ TOKEN }}` style placeholders. GitHub Actions' `${{ … }}` expressions never ship here. */
const TEMPLATE_TOKEN = /(?<!\$)\{\{\s*[\w.-]+\s*\}\}/u;

const all = (selector: string): Element[] => [...doc.querySelectorAll(selector)];

const idRefs = (element: Element, attribute: string): string[] =>
  (element.getAttribute(attribute) ?? '').split(/\s+/u).filter((id) => id !== '');

/** Serialises an element's opening tag, so a failing assertion points at the culprit. */
const describeElement = ({ outerHTML }: Element): string =>
  outerHTML.slice(0, outerHTML.indexOf('>') + 1);

function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label !== null) return label.trim();
  const labelledBy = idRefs(element, 'aria-labelledby');
  if (labelledBy.length > 0) {
    return labelledBy
      .map((id) => doc.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  return element.textContent.trim();
}

describe('index.html', () => {
  it('declares the document language, a title and a zoomable viewport', () => {
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.title.trim()).not.toBe('');

    const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    expect(viewport).toContain('width=device-width');
    // WCAG 1.4.4: users must be able to pinch-zoom.
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?(?!\d)/u);
  });

  it('has exactly one main landmark', () => {
    expect(all('main')).toHaveLength(1);
  });

  it('uses every id only once', () => {
    const ids = all('[id]').map((element) => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('only references ids that exist', () => {
    const dangling: string[] = [];
    for (const attribute of ['aria-describedby', 'aria-labelledby', 'aria-controls', 'for']) {
      for (const element of all(`[${attribute}]`)) {
        for (const id of idRefs(element, attribute)) {
          if (!doc.getElementById(id)) dangling.push(`${attribute}="${id}"`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('labels every form control and declares its autocomplete purpose', () => {
    const controls = all('input:not([type="hidden"])');
    const unlabelled = controls.filter(
      (input) =>
        input.closest('label') === null &&
        doc.querySelector(`label[for="${input.id}"]`) === null &&
        accessibleName(input) === '',
    );
    expect(unlabelled.map(describeElement)).toEqual([]);

    // WCAG 1.3.5 (Identify Input Purpose) lets browsers and password managers fill fields in.
    const withoutPurpose = controls.filter(
      (input) => input.getAttribute('type') !== 'checkbox' && !input.hasAttribute('autocomplete'),
    );
    expect(withoutPurpose.map(describeElement)).toEqual([]);
  });

  it('gives every button an explicit type and an accessible name', () => {
    const buttons = all('button');
    const untyped = buttons.filter(
      (button) => !['button', 'submit', 'reset'].includes(button.getAttribute('type') ?? ''),
    );
    const unnamed = buttons.filter((button) => accessibleName(button) === '');
    expect(untyped.map(describeElement)).toEqual([]);
    expect(unnamed.map(describeElement)).toEqual([]);
  });

  it('hides decorative SVGs from assistive technology', () => {
    const exposed = all('svg').filter(
      (svg) => svg.closest('[aria-hidden="true"]') === null && svg.getAttribute('role') !== 'img',
    );
    expect(exposed.map(describeElement)).toEqual([]);
  });
});

describe('published links', () => {
  it('ships no unresolved template tokens', () => {
    expect(html).not.toMatch(TEMPLATE_TOKEN);
    expect(readme).not.toMatch(TEMPLATE_TOKEN);
  });

  it('points the footer, canonical URL and package metadata at the real repository', () => {
    expect(doc.querySelector('.footer__link')?.getAttribute('href')).toBe(REPOSITORY);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(LIVE_DEMO);
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(LIVE_DEMO);
    expect(pkg.homepage).toBe(LIVE_DEMO);
    expect(pkg.repository.url).toBe(`git+${REPOSITORY}.git`);
    expect(pkg.bugs.url).toBe(`${REPOSITORY}/issues`);
  });

  it('links the README badges and demo to the real repository', () => {
    expect(readme).toContain(`${REPOSITORY}/actions/workflows/ci.yml/badge.svg`);
    expect(readme).toContain(`${REPOSITORY}/actions/workflows/deploy.yml/badge.svg`);
    expect(readme).toContain(`[Live demo](${LIVE_DEMO})`);
    expect(readme).toContain(`git clone ${REPOSITORY}.git`);
  });
});
