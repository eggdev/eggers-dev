import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { Chip, Grid } from "@material-ui/core";

const useStyles = makeStyles((theme) => ({
  filterContainer: {
    margin: `${theme.spacing(2)}px 0`,
    padding: theme.spacing(1),
  },
  filter: {
    margin: theme.spacing(1),
    minWidth: 60,
  },
}));

const Filters = ({ filters = [], selectedFilter, setSelectedFilter }) => {
  const { filterContainer, filter } = useStyles();
  return (
    <Grid className={filterContainer} container spacing={1} justify="center">
      <SingleFilter
        key="clear"
        value="All Projects"
        selected={!selectedFilter}
        handleClick={() => setSelectedFilter(null)}
        className={filter}
      />
      {filters.map((f) => (
        <SingleFilter
          key={f}
          value={f}
          selected={f === selectedFilter}
          handleClick={() => setSelectedFilter(f)}
          className={filter}
        />
      ))}
    </Grid>
  );
};

const SingleFilter = ({ value, selected, handleClick, ...rest }) => {
  return (
    <Chip
      clickable
      label={value}
      color={selected ? "primary" : "default"}
      onClick={handleClick}
      {...rest}
    />
  );
};

export default Filters;
