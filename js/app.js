const button = document.getElementById("myButton");
const header = document.querySelector("h1");

button.addEventListener("click", () => {
  header.textContent = "You clicked the button!";
});
