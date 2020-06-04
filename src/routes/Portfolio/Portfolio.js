import React, { useState, useEffect } from "react";
import { getPortfolioItem } from "../../components/PortfolioItems/PortfolioItems";
import LoadingContainer from "../../components/LoadingContainer/LoadingContainer";
import ErrorComponent from "../../components/ErrorComponent/ErrorComponent";
import Filters from "../../components/Filters/Filters";
import { Container, Grid } from "@material-ui/core";
import useFetch from "../../hooks/useFetch";

import { getFiltersArray } from "../../utils/helpers";

const Portfolio = () => {
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [{ data, isLoading, isError, errorData }, setRequestOptions] = useFetch(
    "portfolio"
  );

  const [filteredProjects, setFilteredProjects] = useState(data);

  const PortfolioItem = getPortfolioItem("desktop");
  const filterArray = getFiltersArray("primary_technologies");

  useEffect(() => {
    setFilteredProjects(
      selectedFilter
        ? [
            ...data.filter(
              (a) =>
                a.primary_technologies.includes(selectedFilter) ||
                a.secondary_technologies.includes(selectedFilter)
            ),
          ]
        : [...data]
    );
  }, [data, selectedFilter]);

  return (
    <Container>
      {isLoading ? (
        <LoadingContainer />
      ) : isError ? (
        <ErrorComponent errorData={errorData} />
      ) : (
        <>
          <Filters
            selectedFilter={selectedFilter}
            setSelectedFilter={setSelectedFilter}
            filters={filterArray}
          />
          <Grid container spacing={2} justify="flex-start">
            {filteredProjects.map((project) => (
              <PortfolioItem key={project._id} data={project} />
            ))}
          </Grid>
        </>
      )}
    </Container>
  );
};

export default Portfolio;
