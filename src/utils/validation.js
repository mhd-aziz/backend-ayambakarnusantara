// src/utils/validation.js

// Fungsi untuk memvalidasi email format
const validateEmail = (email) => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

// Fungsi untuk memvalidasi username (tidak boleh mengandung spasi)
const validateUsername = (username) => {
  return !/\s/.test(username);
};

module.exports = {
  validateEmail,
  validateUsername,
};
