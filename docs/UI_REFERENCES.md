# Références UI, Motion & Pixel Art — Unreleased Glass

Guide pour élever la finition visuelle, les micro-interactions et l'identité Juice WRLD sans alourdir `package.json` ni casser le rendu Liquid Glass iOS 26.

## 1. Sites de référence et ce qu'il faut en retenir

| Source | URL | Ce qu'on reprend (CSS / SVG / WAAPI natif) | Ce qu'on exclut |
|---|---|---|---|
| **Aceternity UI** | https://ui.aceternity.com/ | Spotlight radial doux sous pointeur, lueur de bordure fine (`border-beam` subtil) sur la carte hero | Gradients lourds ou `backdrop-filter` empilés |
| **Magic UI** | https://magicui.design/ | Entrées `blur-fade` courtes (compositées `transform` + `opacity` uniquement), bordure lumineuse fine | Dépendances externes (`framer-motion`) |
| **React Bits** | https://reactbits.dev/ | Micro-élévation douce au survol, reflets spéculaires propres, transitions d'état fluides | Shaders plein écran supplémentaires inutiles |
| **Cult UI** | https://www.cult-ui.com/ | Hiérarchie éditoriale type Apple/bento, espacements respirants, boutons pill nets | Ombres portées opaques |
| **Motion Primitives** | https://motion-primitives.com/ | Courbes d'amortissement courtes (150–250 ms `cubic-bezier(0.22, 1, 0.36, 1)`), zéro thrash layout | Animations continues en `Mode Jeu` ou `reducedMotion` |
| **Uiverse** | https://uiverse.io/ | Micro-interactions de boutons/badges en CSS pur (`transform`, `opacity`) | CSS non scopé, `box-shadow` animés ou `filter` lourds |

## 2. Discover : consigne de Malik du 17 novembre 2026

- Aucun personnage pixel, portrait, corps, chibi, mascotte ou compagnon, dans la carte ou dans un coin de fenêtre. Les anciens composants `JuicePixelBadge` et `JuiceHeroPixel` sont supprimés. Les références pixel ci-dessus ne constituent pas une autorisation d'en réintroduire.
- La zone droite de la carte hero reste vide. Le fond suit le thème choisi, comme Catalogue et Collection ; il suit la cover seulement lorsque les couleurs adaptatives sont activées. Le mesh existant reste lent, derrière l'interface, fixe en mode Jeu ou réduction des animations.
- Conserver la navigation, les covers, le lecteur et la structure hero. Afficher la note catalogue réelle du morceau, ou aucune phrase si elle est absente.

## 3. Garde-fous techniques stricts

1. **Zéro nouveau paquet npm** pour l'UI ou l'animation : tout se fait en CSS, SVG ou Web Animations API natifs.
2. **Propriétés compositées uniquement** : animer `transform` et `opacity` (jamais `width`, `height`, `left`, `top`, `filter` ou `box-shadow` en boucle).
3. **Lisibilité WCAG AA ≥ 4,5:1** en thèmes Dark et Light (`glass-dark` et `glass-light`), sans boîte noire opaque derrière le texte.
4. **Rester compatible WebGPU** : ne pas multiplier les surfaces `.glass-*` enregistrées inutilement et ne pas déclencher de re-mesure DOM en boucle.
