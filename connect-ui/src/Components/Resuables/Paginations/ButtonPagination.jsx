import { useEffect, useState } from "react";
import ReactPaginate from "react-paginate";

const ButtonPagination = (props) => {
  const { totalPages } = props;
  const [currentItems, setCurrentItems] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [itemOffset, setItemOffset] = useState(0);
  let itemsPerPage = 20;
  useEffect(() => {
    setPageCount(Math.ceil(totalPages / itemsPerPage));
  }, [itemOffset, itemsPerPage, totalPages]);

  const handlePageClick = (event) => {
    const newOffset = (event.selected * itemsPerPage) % totalPages;
    props.setCurrentPage(event.selected + 1);
    setItemOffset(newOffset);
  };

  return (
    <>
      <ReactPaginate
        nextLabel=">"
        onPageChange={handlePageClick}
        pageRangeDisplayed={5}
        marginPagesDisplayed={2}
        pageCount={pageCount}
        previousLabel="<"
        pageClassName="page-item"
        pageLinkClassName="page-link"
        previousClassName="page-item"
        previousLinkClassName="page-link"
        nextClassName="page-item"
        nextLinkClassName="page-link"
        breakLabel="..."
        breakClassName="page-item"
        breakLinkClassName="page-link"
        containerClassName="pagination"
        activeClassName="active"
        renderOnZeroPageCount={null}
      />
    </>
  );
};

export default ButtonPagination;
