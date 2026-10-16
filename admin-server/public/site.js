// keeps the hex code next to each color picker in step with the picker
document.querySelectorAll('.color-field input[type="color"]').forEach((input) => {
  const code = input.nextElementSibling;
  input.addEventListener('input', () => (code.textContent = input.value));
});
