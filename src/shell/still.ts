/**
 * A still copy of part of the page, to lay over it while it changes (the
 * fold, a theme's reveal): inert, without ids, its scroll and form state as
 * they were. Call `settle` once the copy is in the page: scroll is only
 * kept by an element that has a box.
 */
export function stillCopy(el: HTMLElement): { copy: HTMLElement; settle: () => void } {
  const copy = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll<HTMLElement>("*")];
  const to = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  const scrolled: [HTMLElement, number, number][] = [];
  from.forEach((source, i) => {
    const same = to[i];
    same.removeAttribute("id");
    if (source.scrollTop || source.scrollLeft)
      scrolled.push([same, source.scrollTop, source.scrollLeft]);
    if (source instanceof HTMLInputElement && same instanceof HTMLInputElement) {
      // Unnamed first: a radio sharing the page's group would take its
      // checked state away.
      same.removeAttribute("name");
      // Kept for a caller that sets the copy's group back as it was.
      if (source.type === "radio") same.dataset.group = source.name;
      same.checked = source.checked;
      same.value = source.value;
    }
  });
  copy.setAttribute("inert", "");
  return {
    copy,
    settle: () => {
      for (const [same, top, left] of scrolled) {
        same.scrollTop = top;
        same.scrollLeft = left;
      }
    },
  };
}
