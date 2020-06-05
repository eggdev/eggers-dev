import { createMuiTheme } from "@material-ui/core/styles";

const Theme = createMuiTheme({
  typography: {
    fontFamily: defaultFontFamily,
  },
  palette: {
    primary: {
      light: "#f2511c",
      main: "#f2511c",
      dark: "#d44703",
    },
  },
});

export default Theme;
