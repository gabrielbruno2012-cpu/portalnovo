function includeHTML() {
  const elements = document.querySelectorAll("[include-html]");
  elements.forEach(el => {

    // esconde o elemento enquanto carrega
    el.style.display = "none";

    const file = el.getAttribute("include-html");
    if (file) {
      fetch(file)
        .then(resp => resp.text())
        .then(data => {
          el.innerHTML = data;
          el.removeAttribute("include-html");

          // mostra somente depois do load
          el.style.display = "block";

          includeHTML(); // permite includes aninhados
        })
        .catch(() => {
          el.innerHTML = "Erro ao carregar componente: " + file;
          el.style.display = "block";
        });
    }
  });
}

document.addEventListener("DOMContentLoaded", includeHTML);
